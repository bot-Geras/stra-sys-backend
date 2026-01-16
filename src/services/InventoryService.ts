import { db, sql } from '../db';
import { medicationStock, prescriptions } from '../db/schema';
import { eq, and, gte, lte, count, sum, desc, asc } from 'drizzle-orm';
import { AppError } from '../middleware/error';
import { logger } from '../config/logger';
import { NotificationService } from './NotificationService';

export class InventoryService {
  private notificationService: NotificationService;

  constructor() {
    this.notificationService = new NotificationService();
  }

  async getMedicationStock(filters?: {
    search?: string;
    lowStock?: boolean;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<any> {
    try {
      const page = filters?.page || 1;
      const limit = filters?.limit || 50;
      const offset = (page - 1) * limit;

      let query = db
        .select()
        .from(medicationStock);

      if (filters?.search) {
        query = query.where(
          sql`${medicationStock.medicationName} ILIKE ${'%' + filters.search + '%'} OR 
               ${medicationStock.genericName} ILIKE ${'%' + filters.search + '%'}`
        );
      }

      if (filters?.lowStock) {
        query = query.where(
          sql`${medicationStock.currentStock} <= ${medicationStock.minimumThreshold}`
        );
      }

      if (filters?.status) {
        query = query.where(
          sql`${medicationStock.status} = ${filters.status}`
        );
      }

      const [total] = await db.select({ count: count() }).from(medicationStock);
      
      const items = await query
        .orderBy(asc(medicationStock.currentStock))
        .limit(limit)
        .offset(offset);

      return {
        items,
        pagination: {
          total: Number(total?.count || 0),
          page,
          limit,
          pages: Math.ceil(Number(total?.count || 0) / limit),
        },
      };
    } catch (error) {
      logger.error('Failed to fetch medication stock:', error);
      throw new AppError('Failed to fetch medication stock', 500);
    }
  }

  async updateStockLevel(medicationId: string, data: {
    adjustment: number;
    reason: string;
    notes?: string;
    transactionType: 'RESTOCK' | 'DISPENSE' | 'ADJUSTMENT' | 'WASTE';
    referenceId?: string;
  }): Promise<any> {
    try {
      return await db.transaction(async (tx) => {
        // Get current medication
        const [medication] = await tx
          .select()
          .from(medicationStock)
          .where(eq(medicationStock.medicationId, medicationId));

        if (!medication) {
          throw new AppError('Medication not found', 404);
        }

        // Calculate new stock
        const newStock = medication.currentStock + data.adjustment;
        
        if (newStock < 0) {
          throw new AppError('Insufficient stock', 400);
        }

        // Update stock
        const [updated] = await tx
          .update(medicationStock)
          .set({
            currentStock: newStock,
            lastRestockDate: data.transactionType === 'RESTOCK' ? sql`${new Date()}` : medication.lastRestockDate,
            updatedAt: new Date(),
          })
          .where(eq(medicationStock.medicationId, medicationId))
          .returning();

        // Check if low stock and send alert
        if (newStock <= medication.minimumThreshold) {
          await this.notificationService.sendLowStockAlert({
            medicationId,
            medicationName: medication.medicationName,
            currentStock: newStock,
            minimumThreshold: medication.minimumThreshold,
          });
        }

        // Log inventory transaction
        await this.logInventoryTransaction({
          medicationId,
          transactionType: data.transactionType,
          quantity: data.adjustment,
          previousStock: medication.currentStock,
          newStock,
          reason: data.reason,
          notes: data.notes,
          referenceId: data.referenceId,
        });

        return updated;
      });
    } catch (error) {
      logger.error('Failed to update stock level:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to update stock level', 500);
    }
  }

  async getLowStockAlerts(): Promise<any[]> {
    try {
      const lowStockItems = await db
        .select()
        .from(medicationStock)
        .where(
          sql`${medicationStock.currentStock} <= ${medicationStock.minimumThreshold} AND 
               ${medicationStock.status} = 'ACTIVE'`
        )
        .orderBy(asc(medicationStock.currentStock));

      // Add reorder recommendations
      return lowStockItems.map(item => ({
        ...item,
        reorderRecommendation: {
          quantity: item.reorderQuantity,
          urgency: item.currentStock === 0 ? 'CRITICAL' : 
                  item.currentStock <= item.minimumThreshold / 2 ? 'HIGH' : 'MEDIUM',
          estimatedCost: Number(item.unitCost) * item.reorderQuantity,
        },
      }));
    } catch (error) {
      logger.error('Failed to fetch low stock alerts:', error);
      throw new AppError('Failed to fetch low stock alerts', 500);
    }
  }

  async getConsumptionAnalytics(timeFrame: 'day' | 'week' | 'month' | 'year'): Promise<any> {
    try {
      let startDate = new Date();
      
      switch (timeFrame) {
        case 'day':
          startDate.setDate(startDate.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
      }

      // Get dispensed prescriptions
      const dispensedMeds = await db
        .select({
          medicationName: medicationStock.medicationName,
          quantity: sql<number>`SUM((item->>'quantity')::int)`,
          totalCost: sql<number>`SUM((item->>'quantity')::int * ${medicationStock.unitCost})`,
        })
        .from(prescriptions)
        .crossJoin(
          sql`jsonb_array_elements(${prescriptions.medications}) as item`
        )
        .leftJoin(
          medicationStock,
          sql`item->>'medicationId' = ${medicationStock.medicationId}::text`
        )
        .where(
          and(
            sql`${prescriptions.isDispensed} = true`,
            gte(prescriptions.dispensedAt, startDate)
          )
        )
        .groupBy(medicationStock.medicationName, medicationStock.unitCost)
        .orderBy(desc(sql`SUM((item->>'quantity')::int)`));

      // Calculate consumption trends
      const totalConsumption = dispensedMeds.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const totalCost = dispensedMeds.reduce((sum, item) => sum + Number(item.totalCost || 0), 0);

      return {
        timeFrame,
        period: { start: startDate, end: new Date() },
        summary: {
          totalItemsConsumed: totalConsumption,
          totalCost: Number(totalCost || 0).toFixed(2),
          averageDailyConsumption: Number(totalConsumption / this.getDaysInTimeFrame(timeFrame)).toFixed(2),
          topMedications: dispensedMeds.slice(0, 10),
        },
        byDepartment: await this.getConsumptionByDepartment(startDate),
        trends: await this.getConsumptionTrends(timeFrame),
      };
    } catch (error) {
      logger.error('Failed to fetch consumption analytics:', error);
      throw new AppError('Failed to fetch consumption analytics', 500);
    }
  }

  private async logInventoryTransaction(data: {
    medicationId: string;
    transactionType: string;
    quantity: number;
    previousStock: number;
    newStock: number;
    reason: string;
    notes?: string;
    referenceId?: string;
  }): Promise<void> {
    // Implementation for inventory transaction logging
    logger.info('Inventory transaction logged:', data);
  }

  private getDaysInTimeFrame(timeFrame: string): number {
    const daysMap = {
      day: 1,
      week: 7,
      month: 30,
      year: 365,
    };
    return daysMap[timeFrame as keyof typeof daysMap] || 1;
  }

  private async getConsumptionByDepartment(startDate: Date): Promise<any[]> {
    // Implementation for department-wise consumption
    return [];
  }

  private async getConsumptionTrends(timeFrame: string): Promise<any[]> {
    // Implementation for consumption trends over time
    return [];
  }
}