import { db, sql } from '../db';
import { resources, departments, patients, departmentQueues } from '../db/schema';
import { eq, and, count, desc, asc } from 'drizzle-orm';
import { AppError } from '../middleware/error';
import { logger } from '../config/logger';
import { RedisService } from './RedisService';

export class ResourceService {
  private redisService: RedisService;

  constructor() {
    this.redisService = new RedisService();
  }

  async getResourceDashboard(): Promise<any> {
    try {
      const cacheKey = 'resource_dashboard';
      const cached = await this.redisService.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      // Get all resources with department info
      const allResources = await db
        .select({
          resourceId: resources.resourceId,
          name: resources.name,
          resourceType: resources.resourceType,
          status: resources.status,
          departmentName: departments.name,
          currentPatientId: resources.currentPatientId,
          patientName: sql<string>`CONCAT(${patients.firstName}, ' ', ${patients.lastName})`,
          lastMaintenance: resources.lastMaintenance,
          nextMaintenance: resources.nextMaintenance,
        })
        .from(resources)
        .leftJoin(departments, eq(resources.departmentId, departments.departmentId))
        .leftJoin(patients, eq(resources.currentPatientId, patients.patientId))
        .orderBy(asc(departments.name), asc(resources.resourceType));

      // Get counts by type and status
      const resourceStats = await db
        .select({
          resourceType: resources.resourceType,
          status: resources.status,
          count: count(),
        })
        .from(resources)
        .groupBy(resources.resourceType, resources.status);

      // Get department-wise resource utilization
      const departmentStats = await db
        .select({
          departmentName: departments.name,
          totalResources: count(),
          availableResources: sql<number>`COUNT(CASE WHEN ${resources.status} = 'AVAILABLE' THEN 1 END)`,
          utilizationRate: sql<number>`ROUND(
            (COUNT(CASE WHEN ${resources.status} = 'OCCUPIED' THEN 1 END)::FLOAT / 
            NULLIF(COUNT(*), 0) * 100), 2
          )`,
        })
        .from(resources)
        .leftJoin(departments, eq(resources.departmentId, departments.departmentId))
        .groupBy(departments.name)
        .orderBy(asc(departments.name));

      // Get maintenance alerts
      const maintenanceAlerts = await db
        .select()
        .from(resources)
        .where(
          and(
            sql`${resources.nextMaintenance} IS NOT NULL`,
            sql`${resources.nextMaintenance} <= CURRENT_DATE + INTERVAL '7 days'`,
            sql`${resources.status} != 'MAINTENANCE'`
          )
        )
        .orderBy(asc(resources.nextMaintenance));

      const result = {
        timestamp: new Date(),
        summary: {
          totalResources: allResources.length,
          available: allResources.filter(r => r.status === 'AVAILABLE').length,
          occupied: allResources.filter(r => r.status === 'OCCUPIED').length,
          underMaintenance: allResources.filter(r => r.status === 'MAINTENANCE').length,
          utilizationRate: allResources.length > 0 ?
            Math.round((allResources.filter(r => r.status === 'OCCUPIED').length / allResources.length) * 100) : 0,
        },
        byType: this.groupByType(allResources),
        byDepartment: departmentStats,
        maintenanceAlerts: maintenanceAlerts.map(r => ({
          resourceId: r.resourceId,
          name: r.name,
          resourceType: r.resourceType,
          nextMaintenance: r.nextMaintenance,
          daysUntil: r.nextMaintenance ? 
            Math.ceil((new Date(r.nextMaintenance).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 0,
        })),
        criticalAlerts: this.generateCriticalAlerts(allResources),
      };

      // Cache for 1 minute
      await this.redisService.set(cacheKey, result, 60);
      
      return result;
    } catch (error) {
      logger.error('Failed to get resource dashboard:', error);
      throw new AppError('Failed to get resource dashboard', 500);
    }
  }

  private groupByType(resources: any[]): any {
    const byType: any = {};
    
    resources.forEach(resource => {
      if (!byType[resource.resourceType]) {
        byType[resource.resourceType] = {
          total: 0,
          available: 0,
          occupied: 0,
          maintenance: 0,
          outOfService: 0,
        };
      }
      
      byType[resource.resourceType].total++;
      byType[resource.resourceType][resource.status.toLowerCase()]++;
    });

    return byType;
  }

  private generateCriticalAlerts(resources: any[]): any[] {
    const alerts = [];

    // Check for low availability of critical resources
    const criticalResources = ['VENTILATOR', 'DEFIBRILLATOR', 'MONITOR'];
    
    for (const type of criticalResources) {
      const typeResources = resources.filter(r => r.resourceType === type);
      const availableCount = typeResources.filter(r => r.status === 'AVAILABLE').length;
      
      if (availableCount <= 2) { // Threshold
        alerts.push({
          type: 'CRITICAL',
          message: `Low availability of ${type}s: Only ${availableCount} available`,
          resourceType: type,
          available: availableCount,
          total: typeResources.length,
        });
      }
    }

    // Check for overdue maintenance
    const today = new Date();
    resources.forEach(resource => {
      if (resource.nextMaintenance && new Date(resource.nextMaintenance) < today) {
        alerts.push({
          type: 'WARNING',
          message: `${resource.name} (${resource.resourceType}) maintenance overdue`,
          resourceId: resource.resourceId,
          resourceName: resource.name,
          overdueDays: Math.ceil((today.getTime() - new Date(resource.nextMaintenance).getTime()) / (1000 * 60 * 60 * 24)),
        });
      }
    });

    return alerts;
  }

  async allocateResource(resourceId: string, patientId: string): Promise<any> {
    try {
      return await db.transaction(async (tx) => {
        const [resource] = await tx
          .select()
          .from(resources)
          .where(eq(resources.resourceId, resourceId));

        if (!resource) {
          throw new AppError('Resource not found', 404);
        }

        if (resource.status !== 'AVAILABLE') {
          throw new AppError(`Resource is ${resource.status.toLowerCase()}`, 400);
        }

        const [updated] = await tx
          .update(resources)
          .set({
            status: 'OCCUPIED',
            currentPatientId: patientId,
            updatedAt: new Date(),
          })
          .where(eq(resources.resourceId, resourceId))
          .returning();

        // Get patient details
        const [patient] = await tx
          .select({
            straId: patients.straId,
            firstName: patients.firstName,
            lastName: patients.lastName,
          })
          .from(patients)
          .where(eq(patients.patientId, patientId));

        // Log allocation
        logger.info(`Resource allocated: ${resource.name} to patient ${patient?.straId}`, {
          resourceId,
          patientId,
        });

        // Clear cache
        await this.redisService.del('resource_dashboard');

        return {
          ...updated,
          patient,
        };
      });
    } catch (error) {
      logger.error('Failed to allocate resource:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to allocate resource', 500);
    }
  }

  async releaseResource(resourceId: string): Promise<any> {
    try {
      return await db.transaction(async (tx) => {
        const [resource] = await tx
          .select()
          .from(resources)
          .where(eq(resources.resourceId, resourceId));

        if (!resource) {
          throw new AppError('Resource not found', 404);
        }

        const [updated] = await tx
          .update(resources)
          .set({
            status: 'AVAILABLE',
            currentPatientId: null,
            updatedAt: new Date(),
          })
          .where(eq(resources.resourceId, resourceId))
          .returning();

        // Log release
        logger.info(`Resource released: ${resource.name}`, { resourceId });

        // Clear cache
        await this.redisService.del('resource_dashboard');

        return updated;
      });
    } catch (error) {
      logger.error('Failed to release resource:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to release resource', 500);
    }
  }

  async setResourceMaintenance(resourceId: string, data: {
    maintenanceDate: Date;
    estimatedCompletion: Date;
    notes?: string;
  }): Promise<any> {
    try {
      const [updated] = await db
        .update(resources)
        .set({
          status: 'MAINTENANCE',
          lastMaintenance: new Date().toISOString(),
          nextMaintenance: data.estimatedCompletion.toISOString(),
          updatedAt: new Date(),
        })
        .where(eq(resources.resourceId, resourceId))
        .returning();

      // Log maintenance
      logger.info(`Resource set to maintenance: ${updated?.name}`, {
        resourceId,
        maintenanceDate: data.maintenanceDate,
        estimatedCompletion: data.estimatedCompletion,
      });

      // Clear cache
      await this.redisService.del('resource_dashboard');

      return updated;
    } catch (error) {
      logger.error('Failed to set resource maintenance:', error);
      throw new AppError('Failed to set resource maintenance', 500);
    }
  }

  async getPredictiveLoad(hours: number = 4): Promise<any> {
    try {
      const cacheKey = `predictive_load:${hours}`;
      const cached = await this.redisService.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      // Get historical data for prediction
      const historicalData = await db
        .select({
          hour: sql<number>`EXTRACT(HOUR FROM ${departmentQueues.createdAt})`,
          dayOfWeek: sql<number>`EXTRACT(DOW FROM ${departmentQueues.createdAt})`,
          patientCount: count(),
          avgWaitTime: sql<number>`AVG(${departmentQueues.expectedWaitTime})`,
        })
        .from(departmentQueues)
        .where(sql`${departmentQueues.createdAt} >= CURRENT_DATE - INTERVAL '30 days'`)
        .groupBy(
          sql`EXTRACT(HOUR FROM ${departmentQueues.createdAt})`,
          sql`EXTRACT(DOW FROM ${departmentQueues.createdAt})`
        );

      // Simple prediction algorithm (in production, use ML)
      const now = new Date();
      const currentHour = now.getHours();
      const currentDay = now.getDay();
      
      // Find similar historical patterns
      const similarPatterns = historicalData.filter(data => 
        data.dayOfWeek === currentDay && 
        Math.abs(data.hour - currentHour) <= 2
      );

      const avgPatientCount = similarPatterns.length > 0 ?
        similarPatterns.reduce((sum, p) => sum + Number(p.patientCount), 0) / similarPatterns.length : 20;

      const prediction = {
        timestamp: now,
        forecastHours: hours,
        predictedPatientLoad: Math.round(avgPatientCount * (hours / 4)),
        confidence: similarPatterns.length > 5 ? 0.8 : 0.5,
        recommendations: this.generateRecommendations(avgPatientCount, hours),
        hourlyBreakdown: this.generateHourlyBreakdown(currentHour, hours, historicalData),
      };

      // Cache for 15 minutes
      await this.redisService.set(cacheKey, prediction, 900);
      
      return prediction;
    } catch (error) {
      logger.error('Failed to get predictive load:', error);
      throw new AppError('Failed to get predictive load', 500);
    }
  }

  private generateRecommendations(patientLoad: number, hours: number): string[] {
    const recommendations = [];
    
    if (patientLoad > 50) {
      recommendations.push('Activate additional triage stations');
      recommendations.push('Prepare overflow area');
    }
    
    if (patientLoad > 30) {
      recommendations.push('Schedule extra nursing staff');
      recommendations.push('Check critical equipment availability');
    }
    
    if (hours > 8) {
      recommendations.push('Plan for shift rotations');
      recommendations.push('Order additional supplies');
    }
    
    return recommendations;
  }

  private generateHourlyBreakdown(currentHour: number, hours: number, historicalData: any[]): any[] {
    const breakdown = [];
    
    for (let i = 0; i < hours; i++) {
      const hour = (currentHour + i) % 24;
      const similarData = historicalData.filter(data => Math.abs(data.hour - hour) <= 1);
      
      const predictedLoad = similarData.length > 0 ?
        Math.round(similarData.reduce((sum, p) => sum + Number(p.patientCount), 0) / similarData.length) : 15;
      
      breakdown.push({
        hour: `${hour}:00`,
        predictedLoad,
        confidence: similarData.length > 3 ? 'HIGH' : 'MEDIUM',
      });
    }
    
    return breakdown;
  }
}