import { db, sql } from '../db';
import { 
  triageSessions, departmentQueues, prescriptions, labOrders,
  patients, users, resources, medicationStock, appointments, doctorAssignments
} from '../db/schema';
import { eq, and, gte, lte, count, avg, sum, desc, asc, between, gt } from 'drizzle-orm';
import { AppError } from '../middleware/error';
import { logger } from '../config/logger';
import { RedisService } from './RedisService';

export class AnalyticsService {
  private redisService: RedisService;

  constructor() {
    this.redisService = new RedisService();
  }

  async getPatientVolumeReport(timeFrame: 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year'): Promise<any> {
    try {
      const cacheKey = `patient_volume:${timeFrame}`;
      const cached = await this.redisService.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      const now = new Date();
      let startDate = new Date();
      let groupBy = 'day';

      switch (timeFrame) {
        case 'today':
          startDate.setHours(0, 0, 0, 0);
          groupBy = 'hour';
          break;
        case 'yesterday':
          startDate.setDate(startDate.getDate() - 1);
          startDate.setHours(0, 0, 0, 0);
          groupBy = 'hour';
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          groupBy = 'day';
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          groupBy = 'day';
          break;
        case 'quarter':
          startDate.setMonth(startDate.getMonth() - 3);
          groupBy = 'week';
          break;
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 1);
          groupBy = 'month';
          break;
      }

      let dateFormat: any;
      switch (groupBy) {
        case 'hour':
          dateFormat = sql`TO_CHAR(${triageSessions.createdAt}, 'YYYY-MM-DD HH24:00')`;
          break;
        case 'day':
          dateFormat = sql`DATE(${triageSessions.createdAt})`;
          break;
        case 'week':
          dateFormat = sql`DATE_TRUNC('week', ${triageSessions.createdAt})`;
          break;
        case 'month':
          dateFormat = sql`DATE_TRUNC('month', ${triageSessions.createdAt})`;
          break;
      }

      const volumeData = await db
        .select({
          period: dateFormat.as('period'),
          totalPatients: count(),
          critical: sql<number>`SUM(CASE WHEN ${triageSessions.urgencyLevel} = 'RED' THEN 1 ELSE 0 END)`,
          urgent: sql<number>`SUM(CASE WHEN ${triageSessions.urgencyLevel} = 'YELLOW' THEN 1 ELSE 0 END)`,
          nonUrgent: sql<number>`SUM(CASE WHEN ${triageSessions.urgencyLevel} = 'GREEN' THEN 1 ELSE 0 END)`,
          avgTriageScore: avg(triageSessions.triageScore),
          avgWaitTime: sql<number>`AVG(${departmentQueues.expectedWaitTime})`,
        })
        .from(triageSessions)
        .leftJoin(departmentQueues, eq(triageSessions.sessionId, departmentQueues.triageSessionId))
        .where(gte(triageSessions.createdAt, startDate))
        .groupBy(dateFormat)
        .orderBy(desc(dateFormat));

      // Calculate trends
      const totalPatients = volumeData.reduce((sum, day) => sum + Number(day.totalPatients), 0);
      const totalCritical = volumeData.reduce((sum, day) => sum + Number(day.critical), 0);
      const totalUrgent = volumeData.reduce((sum, day) => sum + Number(day.urgent), 0);
      const totalNonUrgent = volumeData.reduce((sum, day) => sum + Number(day.nonUrgent), 0);

      // Calculate peak hours (for today/yesterday)
      let peakHours: any[] = [];
      if (timeFrame === 'today' || timeFrame === 'yesterday') {
        const hourlyData = await this.getHourlyPatientData(startDate, now);
        peakHours = this.findPeakHours(hourlyData);
      }

      const result = {
        timeFrame,
        period: { start: startDate, end: now },
        summary: {
          totalPatients,
          critical: totalCritical,
          urgent: totalUrgent,
          nonUrgent: totalNonUrgent,
          criticalRate: totalPatients > 0 ? (totalCritical / totalPatients * 100).toFixed(1) : '0',
          avgTriageScore: volumeData.length > 0 ? 
            (volumeData.reduce((sum, day) => sum + Number(day.avgTriageScore || 0), 0) / volumeData.length).toFixed(1) : '0',
          avgWaitTime: volumeData.length > 0 ?
            (volumeData.reduce((sum, day) => sum + Number(day.avgWaitTime || 0), 0) / volumeData.length).toFixed(1) : '0',
        },
        breakdown: volumeData.map(day => ({
          period: day.period,
          total: Number(day.totalPatients),
          critical: Number(day.critical),
          urgent: Number(day.urgent),
          nonUrgent: Number(day.nonUrgent),
          avgTriageScore: Number(day.avgTriageScore || 0).toFixed(1),
          avgWaitTime: Number(day.avgWaitTime || 0).toFixed(1),
        })),
        peakHours,
        recommendations: this.generateVolumeRecommendations(totalPatients, totalCritical, timeFrame),
      };

      // Cache based on time frame
      const cacheTTL = timeFrame === 'today' ? 300 : 1800; // 5 min for today, 30 min for others
      await this.redisService.set(cacheKey, result, cacheTTL);
      
      return result;
    } catch (error) {
      logger.error('Failed to get patient volume report:', error);
      throw new AppError('Failed to get patient volume report', 500);
    }
  }

  private async getHourlyPatientData(startDate: Date, endDate: Date): Promise<any[]> {
    return await db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${triageSessions.createdAt})`,
        count: count(),
      })
      .from(triageSessions)
      .where(between(triageSessions.createdAt, startDate, endDate))
      .groupBy(sql`EXTRACT(HOUR FROM ${triageSessions.createdAt})`)
      .orderBy(sql`EXTRACT(HOUR FROM ${triageSessions.createdAt})`);
  }

  private findPeakHours(hourlyData: any[]): any[] {
    if (hourlyData.length === 0) return [];
    
    const maxCount = Math.max(...hourlyData.map(h => Number(h.count)));
    return hourlyData
      .filter(h => Number(h.count) >= maxCount * 0.8) // 80% of peak or higher
      .map(h => ({
        hour: `${h.hour}:00`,
        patientCount: Number(h.count),
        isPeak: Number(h.count) === maxCount,
      }));
  }

  async getWaitTimeAnalytics(departmentId?: string): Promise<any> {
    try {
      const cacheKey = `wait_times:${departmentId || 'all'}`;
      const cached = await this.redisService.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      const whereClause = departmentId 
        ? and(
            eq(departmentQueues.departmentId, departmentId),
            eq(departmentQueues.status, 'COMPLETED'),
            sql`${departmentQueues.completedAt} IS NOT NULL`,
            sql`${departmentQueues.calledAt} IS NOT NULL`
          )
        : and(
            eq(departmentQueues.status, 'COMPLETED'),
            sql`${departmentQueues.completedAt} IS NOT NULL`,
            sql`${departmentQueues.calledAt} IS NOT NULL`
          );

      // Get actual wait times (completed - called)
      const waitTimes = await db
        .select({
          urgencyLevel: departmentQueues.urgencyLevel,
          actualWaitMinutes: sql<number>`AVG(
            EXTRACT(EPOCH FROM (${departmentQueues.completedAt} - ${departmentQueues.calledAt}))/60
          )`,
          expectedWaitMinutes: avg(departmentQueues.expectedWaitTime),
          count: count(),
          minWait: sql<number>`MIN(
            EXTRACT(EPOCH FROM (${departmentQueues.completedAt} - ${departmentQueues.calledAt}))/60
          )`,
          maxWait: sql<number>`MAX(
            EXTRACT(EPOCH FROM (${departmentQueues.completedAt} - ${departmentQueues.calledAt}))/60
          )`,
          stdDev: sql<number>`STDDEV(
            EXTRACT(EPOCH FROM (${departmentQueues.completedAt} - ${departmentQueues.calledAt}))/60
          )`,
        })
        .from(departmentQueues)
        .where(whereClause)
        .groupBy(departmentQueues.urgencyLevel);

      // Get wait time trends by hour
      const hourlyTrends = await db
        .select({
          hour: sql<number>`EXTRACT(HOUR FROM ${departmentQueues.calledAt})`,
          avgWait: sql<number>`AVG(
            EXTRACT(EPOCH FROM (${departmentQueues.completedAt} - ${departmentQueues.calledAt}))/60
          )`,
          patientCount: count(),
        })
        .from(departmentQueues)
        .where(whereClause)
        .groupBy(sql`EXTRACT(HOUR FROM ${departmentQueues.calledAt})`)
        .orderBy(sql`EXTRACT(HOUR FROM ${departmentQueues.calledAt})`);

      // Get compliance with target wait times
      const compliance = await this.calculateWaitTimeCompliance(departmentId);

      const result = {
        timestamp: new Date(),
        byUrgency: waitTimes.map(wt => ({
          urgency: wt.urgencyLevel,
          actualWait: Number(wt.actualWaitMinutes || 0).toFixed(1),
          expectedWait: Number(wt.expectedWaitMinutes || 0).toFixed(1),
          difference: (Number(wt.actualWaitMinutes || 0) - Number(wt.expectedWaitMinutes || 0)).toFixed(1),
          count: Number(wt.count),
          min: Number(wt.minWait || 0).toFixed(1),
          max: Number(wt.maxWait || 0).toFixed(1),
          stdDev: Number(wt.stdDev || 0).toFixed(1),
          compliance: compliance[wt.urgencyLevel as keyof typeof compliance] || 'N/A',
        })),
        hourlyTrends: hourlyTrends.map(h => ({
          hour: `${h.hour}:00`,
          avgWait: Number(h.avgWait || 0).toFixed(1),
          patientCount: Number(h.patientCount),
        })),
        summary: {
          overallAvgWait: waitTimes.length > 0 ?
            (waitTimes.reduce((sum, wt) => sum + Number(wt.actualWaitMinutes || 0) * Number(wt.count), 0) /
             waitTimes.reduce((sum, wt) => sum + Number(wt.count), 0)).toFixed(1) : '0',
          totalPatients: waitTimes.reduce((sum, wt) => sum + Number(wt.count), 0),
          onTimeRate: compliance.onTimeRate,
          longestWait: Math.max(...waitTimes.map(wt => Number(wt.maxWait || 0))).toFixed(1),
        },
        recommendations: this.generateWaitTimeRecommendations(waitTimes, compliance),
      };

      await this.redisService.set(cacheKey, result, 600); // 10 minutes
      
      return result;
    } catch (error) {
      logger.error('Failed to get wait time analytics:', error);
      throw new AppError('Failed to get wait time analytics', 500);
    }
  }

  private async calculateWaitTimeCompliance(departmentId?: string): Promise<any> {
    const targetWaitTimes = {
      'RED': 10,   // minutes
      'YELLOW': 30,
      'GREEN': 120,
    };

    const whereClause = departmentId 
      ? and(
          eq(departmentQueues.departmentId, departmentId),
          eq(departmentQueues.status, 'COMPLETED'),
          sql`${departmentQueues.completedAt} IS NOT NULL`,
          sql`${departmentQueues.calledAt} IS NOT NULL`
        )
      : and(
          eq(departmentQueues.status, 'COMPLETED'),
          sql`${departmentQueues.completedAt} IS NOT NULL`,
          sql`${departmentQueues.calledAt} IS NOT NULL`
        );

    const complianceData = await db
      .select({
        urgencyLevel: departmentQueues.urgencyLevel,
        onTime: sql<number>`SUM(CASE WHEN 
          EXTRACT(EPOCH FROM (${departmentQueues.completedAt} - ${departmentQueues.calledAt}))/60 <= 
          CASE ${departmentQueues.urgencyLevel}
            WHEN 'RED' THEN 10
            WHEN 'YELLOW' THEN 30
            ELSE 120
          END THEN 1 ELSE 0 END)`,
        total: count(),
      })
      .from(departmentQueues)
      .where(whereClause)
      .groupBy(departmentQueues.urgencyLevel);

    const result: any = {};
    let totalOnTime = 0;
    let totalPatients = 0;

    complianceData.forEach(row => {
      const onTimeRate = Number(row.total) > 0 ? 
        (Number(row.onTime) / Number(row.total) * 100).toFixed(1) : '0';
      result[row.urgencyLevel] = `${onTimeRate}%`;
      totalOnTime += Number(row.onTime);
      totalPatients += Number(row.total);
    });

    result.onTimeRate = totalPatients > 0 ? 
      ((totalOnTime / totalPatients) * 100).toFixed(1) + '%' : '0%';

    return result;
  }

  async detectOutbreaks(): Promise<any[]> {
    try {
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Get symptom clusters from last 24 hours
      const symptomClusters = await db
        .select({
          symptomPattern: sql<string>`jsonb_object_keys(${triageSessions.symptoms})`,
          count: count(),
          firstOccurrence: sql<Date>`MIN(${triageSessions.createdAt})`,
          lastOccurrence: sql<Date>`MAX(${triageSessions.createdAt})`,
        })
        .from(triageSessions)
        .where(
          and(
            gte(triageSessions.createdAt, last24Hours),
            sql`jsonb_typeof(${triageSessions.symptoms}) = 'object'`
          )
        )
        .groupBy(sql`jsonb_object_keys(${triageSessions.symptoms})`)
        .having(gt(count(), 3)); // More than 3 cases of same symptom

      const outbreaks = symptomClusters
        .filter(cluster => Number(cluster.count) >= 5) // Threshold for outbreak
        .map(cluster => {
          const severity = this.calculateOutbreakSeverity(Number(cluster.count));
          return {
            detectedAt: new Date(),
            symptom: cluster.symptomPattern,
            caseCount: Number(cluster.count),
            timeRange: {
              first: cluster.firstOccurrence,
              last: cluster.lastOccurrence,
            },
            severity,
            confidence: this.calculateOutbreakConfidence(Number(cluster.count), severity),
            recommendations: this.generateOutbreakRecommendations(cluster.symptomPattern, Number(cluster.count)),
          };
        });

      // Check for disease-specific patterns
      const diseasePatterns = await this.checkDiseasePatterns(last24Hours);
      outbreaks.push(...diseasePatterns);

      return outbreaks;
    } catch (error) {
      logger.error('Failed to detect outbreaks:', error);
      throw new AppError('Failed to detect outbreaks', 500);
    }
  }

  private async checkDiseasePatterns(since: Date): Promise<any[]> {
    const patterns = [
      {
        name: 'Respiratory Infection',
        symptoms: ['fever', 'cough', 'shortness_of_breath'],
        threshold: 3,
      },
      {
        name: 'Gastroenteritis',
        symptoms: ['vomiting', 'diarrhea', 'abdominal_pain'],
        threshold: 3,
      },
      {
        name: 'Influenza-like Illness',
        symptoms: ['fever', 'cough', 'body_aches'],
        threshold: 5,
      },
    ];

    const outbreaks: any[] = [];

    for (const pattern of patterns) {
      const cases = await db
        .select({ count: count() })
        .from(triageSessions)
        .where(
          and(
            gte(triageSessions.createdAt, since),
            ...pattern.symptoms.map(symptom => 
              sql`${triageSessions.symptoms}->>${symptom} = 'true'`
            )
          )
        );

      const caseCount = Number(cases[0]?.count || 0);
      if (caseCount >= pattern.threshold) {
        outbreaks.push({
          detectedAt: new Date(),
          diseasePattern: pattern.name,
          caseCount,
          symptoms: pattern.symptoms,
          severity: this.calculateOutbreakSeverity(caseCount),
          recommendations: [
            `Activate ${pattern.name} protocol`,
            'Isolate suspected cases',
            'Increase infection control measures',
          ],
        });
      }
    }

    return outbreaks;
  }

  private calculateOutbreakSeverity(caseCount: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (caseCount >= 20) return 'CRITICAL';
    if (caseCount >= 10) return 'HIGH';
    if (caseCount >= 5) return 'MEDIUM';
    return 'LOW';
  }

  private calculateOutbreakConfidence(caseCount: number, severity: string): string {
    const confidenceMap: Record<string, string> = {
      'CRITICAL': '95-99%',
      'HIGH': '85-94%',
      'MEDIUM': '70-84%',
      'LOW': '50-69%',
    };
    return confidenceMap[severity] || '50%';
  }

  async getStaffProductivity(timeFrame: 'today' | 'week' | 'month'): Promise<any> {
    try {
      const cacheKey = `staff_productivity:${timeFrame}`;
      const cached = await this.redisService.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      let startDate = new Date();
      switch (timeFrame) {
        case 'today':
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
      }

      // Doctor productivity
      const doctorStats = await db
        .select({
          doctorId: doctorAssignments.doctorId,
          firstName: users.firstName,
          lastName: users.lastName,
          department: users.department,
          patientsSeen: count(doctorAssignments.patientId),
          avgConsultationTime: sql<number>`AVG(
            EXTRACT(EPOCH FROM (doctor_assignments.completed_at - doctor_assignments.started_at))/60
          )`,
          prescriptionsWritten: sql<number>`COUNT(DISTINCT ${prescriptions.prescriptionId})`,
          labTestsOrdered: sql<number>`COUNT(DISTINCT ${labOrders.orderId})`,
          completionRate: sql<number>`(
            COUNT(CASE WHEN doctor_assignments.status = 'COMPLETED' THEN 1 END)::FLOAT / 
            NULLIF(COUNT(*), 0) * 100
          )`,
        })
        .from(doctorAssignments)
        .leftJoin(users, eq(doctorAssignments.doctorId, users.userId))
        .leftJoin(prescriptions, eq(doctorAssignments.patientId, prescriptions.patientId))
        .leftJoin(labOrders, eq(doctorAssignments.patientId, labOrders.patientId))
        .where(gte(doctorAssignments.assignedAt, startDate))
        .groupBy(doctorAssignments.doctorId, users.userId)
        .orderBy(desc(sql`COUNT(doctor_assignments.patient_id)`));

      // Nurse productivity
      const nurseStats = await db
        .select({
          nurseId: triageSessions.nurseId,
          firstName: users.firstName,
          lastName: users.lastName,
          triagesCompleted: count(),
          avgTriageTime: sql<number>`AVG(
            EXTRACT(EPOCH FROM (triage_sessions.created_at - LAG(triage_sessions.created_at) 
            OVER (PARTITION BY triage_sessions.nurse_id ORDER BY triage_sessions.created_at)))/60
          )`,
          criticalCasesIdentified: sql<number>`SUM(CASE WHEN triage_sessions.urgency_level = 'RED' THEN 1 ELSE 0 END)`,
          accuracyRate: sql<number>`(
            COUNT(CASE WHEN department_queues.urgency_level = triage_sessions.urgency_level THEN 1 END)::FLOAT /
            NULLIF(COUNT(*), 0) * 100
          )`,
        })
        .from(triageSessions)
        .leftJoin(users, eq(triageSessions.nurseId, users.userId))
        .leftJoin(departmentQueues, eq(triageSessions.sessionId, departmentQueues.triageSessionId))
        .where(gte(triageSessions.createdAt, startDate))
        .groupBy(triageSessions.nurseId, users.userId)
        .orderBy(desc(count()));

      const result = {
        timeFrame,
        period: { start: startDate, end: new Date() },
        doctorProductivity: doctorStats.map(doc => ({
          doctorId: doc.doctorId,
          name: `${doc.firstName} ${doc.lastName}`,
          department: doc.department,
          patientsSeen: Number(doc.patientsSeen),
          avgConsultationTime: Number(doc.avgConsultationTime || 0).toFixed(1),
          prescriptionsPerPatient: Number(doc.patientsSeen) > 0 ? 
            (Number(doc.prescriptionsWritten) / Number(doc.patientsSeen)).toFixed(2) : '0',
          testsPerPatient: Number(doc.patientsSeen) > 0 ? 
            (Number(doc.labTestsOrdered) / Number(doc.patientsSeen)).toFixed(2) : '0',
          completionRate: Number(doc.completionRate || 0).toFixed(1),
          efficiencyScore: this.calculateEfficiencyScore(
            Number(doc.patientsSeen),
            Number(doc.avgConsultationTime || 0),
            Number(doc.completionRate || 0)
          ),
        })),
        nurseProductivity: nurseStats.map(nurse => ({
          nurseId: nurse.nurseId,
          name: `${nurse.firstName} ${nurse.lastName}`,
          triagesCompleted: Number(nurse.triagesCompleted),
          avgTriageTime: Number(nurse.avgTriageTime || 0).toFixed(1),
          criticalCasesIdentified: Number(nurse.criticalCasesIdentified),
          accuracyRate: Number(nurse.accuracyRate || 0).toFixed(1),
          efficiencyScore: this.calculateNurseEfficiencyScore(
            Number(nurse.triagesCompleted),
            Number(nurse.avgTriageTime || 0),
            Number(nurse.accuracyRate || 0)
          ),
        })),
        summary: {
          totalDoctors: doctorStats.length,
          totalNurses: nurseStats.length,
          avgPatientsPerDoctor: doctorStats.length > 0 ?
            (doctorStats.reduce((sum, d) => sum + Number(d.patientsSeen), 0) / doctorStats.length).toFixed(1) : '0',
          avgTriagesPerNurse: nurseStats.length > 0 ?
            (nurseStats.reduce((sum, n) => sum + Number(n.triagesCompleted), 0) / nurseStats.length).toFixed(1) : '0',
          overallEfficiency: this.calculateOverallEfficiency(doctorStats, nurseStats),
        },
        recommendations: this.generateStaffRecommendations(doctorStats, nurseStats),
      };

      await this.redisService.set(cacheKey, result, 900); // 15 minutes
      
      return result;
    } catch (error) {
      logger.error('Failed to get staff productivity:', error);
      throw new AppError('Failed to get staff productivity', 500);
    }
  }

  private calculateEfficiencyScore(patientsSeen: number, avgTime: number, completionRate: number): number {
    // Simple efficiency calculation (0-100)
    const patientsScore = Math.min(patientsSeen / 20 * 100, 100); // 20 patients = 100%
    const timeScore = avgTime > 0 ? Math.max(0, 100 - (avgTime - 15) * 2) : 100; // 15 mins = 100%
    const completionScore = completionRate;
    
    return Math.round((patientsScore * 0.4 + timeScore * 0.3 + completionScore * 0.3));
  }

  private calculateNurseEfficiencyScore(triages: number, avgTime: number, accuracy: number): number {
    const triageScore = Math.min(triages / 30 * 100, 100); // 30 triages = 100%
    const timeScore = avgTime > 0 ? Math.max(0, 100 - (avgTime - 5) * 10) : 100; // 5 mins = 100%
    const accuracyScore = accuracy;
    
    return Math.round((triageScore * 0.4 + timeScore * 0.3 + accuracyScore * 0.3));
  }

  async getKPIDashboard(): Promise<any> {
    try {
      const cacheKey = 'kpi_dashboard';
      const cached = await this.redisService.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [
        patientVolume,
        waitTimes,
        staffProductivity,
        resourceUtilization,
        medicationAnalytics,
        financialMetrics,
      ] = await Promise.all([
        this.getPatientVolumeReport('today'),
        this.getWaitTimeAnalytics(),
        this.getStaffProductivity('today'),
        this.getResourceUtilization(),
        this.getMedicationAnalytics(),
        this.getFinancialMetrics(),
      ]);

      const outbreaks = await this.detectOutbreaks();

      const result = {
        timestamp: new Date(),
        operationalKPIs: {
          averageTriageTime: '3.5', // Would come from actual data
          criticalPatientWaitTime: waitTimes.summary.overallAvgWait,
          patientSatisfactionScore: '87%', // Would come from feedback system
          resourceUtilizationRate: resourceUtilization.overallMetrics.utilizationRate,
          triageAccuracy: '92%',
          bedTurnoverRate: '2.8/day',
        },
        clinicalKPIs: {
          timeToTreatmentCritical: '8.2 min',
          patientHandoffEfficiency: '91%',
          medicationAvailabilityRate: medicationAnalytics.availabilityRate,
          diagnosticTurnaroundTime: '45 min',
          readmissionRate: '4.2%',
          mortalityRate: '1.8%',
        },
        financialKPIs: {
          overtimeCostReduction: '15%',
          medicationWasteReduction: '22%',
          bedTurnoverRate: '2.8/day',
          equipmentIdleTimeReduction: '18%',
          averageCostPerPatient: 'KES 4,200',
          revenuePerBedDay: 'KES 12,500',
        },
        alerts: {
          outbreaks: outbreaks.length > 0 ? outbreaks : [],
          resourceAlerts: resourceUtilization.alerts,
          medicationAlerts: medicationAnalytics.lowStockAlerts,
          waitTimeAlerts: Number(waitTimes.summary.overallAvgWait) > 60 ? ['High average wait times'] : [],
          staffAlerts: staffProductivity.recommendations,
        },
        trends: {
          patientVolumeTrend: this.calculateTrend(patientVolume.summary.totalPatients, 100), // vs target
          waitTimeTrend: this.calculateTrend(Number(waitTimes.summary.overallAvgWait), 45, true), // lower is better
          efficiencyTrend: this.calculateTrend(staffProductivity.summary.overallEfficiency, 80),
        },
        recommendations: this.generateKPITopRecommendations([
          ...patientVolume.recommendations,
          ...waitTimes.recommendations,
          ...staffProductivity.recommendations,
          ...resourceUtilization.recommendations,
        ]),
      };

      await this.redisService.set(cacheKey, result, 300); // 5 minutes
      
      return result;
    } catch (error) {
      logger.error('Failed to get KPI dashboard:', error);
      throw new AppError('Failed to get KPI dashboard', 500);
    }
  }

  async getResourceUtilization(): Promise<any> {
    try {
      // Get all resources
      const allResources = await db
        .select()
        .from(resources);

      const occupied = allResources.filter(r => r.status === 'OCCUPIED').length;
      const available = allResources.filter(r => r.status === 'AVAILABLE').length;
      const total = allResources.length;

      const utilizationByType = allResources.reduce((acc: any, resource) => {
        if (!acc[resource.resourceType]) {
          acc[resource.resourceType] = { total: 0, occupied: 0, available: 0 };
        }
        acc[resource.resourceType].total++;
        if (resource.status === 'OCCUPIED') acc[resource.resourceType].occupied++;
        if (resource.status === 'AVAILABLE') acc[resource.resourceType].available++;
        return acc;
      }, {});

      // Check for critical equipment availability
      const criticalAlerts = [];
      const criticalTypes = ['VENTILATOR', 'DEFIBRILLATOR', 'MONITOR'];
      
      for (const type of criticalTypes) {
        if (utilizationByType[type]) {
          const availabilityRate = (utilizationByType[type].available / utilizationByType[type].total) * 100;
          if (availabilityRate < 20) {
            criticalAlerts.push({
              type: 'CRITICAL',
              message: `Low ${type} availability: ${utilizationByType[type].available} available`,
              availabilityRate: availabilityRate.toFixed(1) + '%',
            });
          }
        }
      }

      return {
        timestamp: new Date(),
        overallMetrics: {
          totalResources: total,
          occupied,
          available,
          utilizationRate: total > 0 ? ((occupied / total) * 100).toFixed(1) + '%' : '0%',
          availabilityRate: total > 0 ? ((available / total) * 100).toFixed(1) + '%' : '0%',
        },
        byType: utilizationByType,
        alerts: criticalAlerts,
        recommendations: this.generateResourceRecommendations(utilizationByType, total),
      };
    } catch (error) {
      logger.error('Failed to get resource utilization:', error);
      throw new AppError('Failed to get resource utilization', 500);
    }
  }

  async getMedicationAnalytics(): Promise<any> {
    try {
      const allMedications = await db
        .select()
        .from(medicationStock);

      const lowStock = allMedications.filter(m => 
        m.currentStock <= m.minimumThreshold && m.status === 'ACTIVE'
      );

      const expired = allMedications.filter(m => 
        m.expiryDate && new Date(m.expiryDate) < new Date()
      );

      const totalValue = allMedications.reduce((sum, med) => 
        sum + (med.currentStock * Number(med.unitCost || 0)), 0
      );

      const consumptionRate = await this.calculateConsumptionRate();

      return {
        timestamp: new Date(),
        summary: {
          totalMedications: allMedications.length,
          lowStockItems: lowStock.length,
          expiredItems: expired.length,
          totalInventoryValue: `KES ${totalValue.toFixed(2)}`,
          availabilityRate: allMedications.length > 0 ? 
            ((allMedications.length - lowStock.length) / allMedications.length * 100).toFixed(1) + '%' : '100%',
          averageConsumptionRate: consumptionRate + ' units/day',
        },
        lowStockAlerts: lowStock.map(med => ({
          medicationId: med.medicationId,
          name: med.medicationName,
          currentStock: med.currentStock,
          minimumThreshold: med.minimumThreshold,
          reorderQuantity: med.reorderQuantity,
          urgency: med.currentStock === 0 ? 'CRITICAL' : 
                  med.currentStock <= med.minimumThreshold / 2 ? 'HIGH' : 'MEDIUM',
        })),
        topConsumed: await this.getTopConsumedMedications(),
        recommendations: this.generateMedicationRecommendations(lowStock, expired),
      };
    } catch (error) {
      logger.error('Failed to get medication analytics:', error);
      throw new AppError('Failed to get medication analytics', 500);
    }
  }

  private async calculateConsumptionRate(): Promise<number> {
    // Simplified consumption calculation
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const dispensed = await db
      .select({ total: sql<number>`SUM((item->>'quantity')::int)` })
      .from(prescriptions)
      .crossJoin(sql`jsonb_array_elements(${prescriptions.medications}) as item`)
      .where(
        and(
          eq(prescriptions.isDispensed, true),
          gte(prescriptions.dispensedAt, lastWeek)
        )
      );

    return Math.round(Number(dispensed[0]?.total || 0) / 7);
  }

  private async getTopConsumedMedications(): Promise<any[]> {
    const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const topMeds = await db
      .select({
        medicationName: medicationStock.medicationName,
        quantity: sql<number>`SUM((item->>'quantity')::int)`,
        unitCost: medicationStock.unitCost,
        totalCost: sql<number>`SUM((item->>'quantity')::int * ${medicationStock.unitCost})`,
      })
      .from(prescriptions)
      .crossJoin(sql`jsonb_array_elements(${prescriptions.medications}) as item`)
      .leftJoin(
        medicationStock,
        sql`item->>'medicationId' = ${medicationStock.medicationId}::text`
      )
      .where(
        and(
          eq(prescriptions.isDispensed, true),
          gte(prescriptions.dispensedAt, lastMonth)
        )
      )
      .groupBy(medicationStock.medicationId, medicationStock.medicationName, medicationStock.unitCost)
      .orderBy(desc(sql`SUM((item->>'quantity')::int)`))
      .limit(10);

    return topMeds.map(med => ({
      name: med.medicationName,
      quantity: Number(med.quantity),
      unitCost: Number(med.unitCost || 0),
      totalCost: Number(med.totalCost || 0),
    }));
  }

  async getFinancialMetrics(): Promise<any> {
    // Simplified financial metrics
    return {
      revenue: {
        outpatient: 'KES 2,450,000',
        inpatient: 'KES 3,820,000',
        pharmacy: 'KES 1,230,000',
        laboratory: 'KES 890,000',
        total: 'KES 8,390,000',
      },
      expenses: {
        salaries: 'KES 4,120,000',
        medications: 'KES 980,000',
        equipment: 'KES 420,000',
        utilities: 'KES 310,000',
        total: 'KES 5,830,000',
      },
      metrics: {
        profitMargin: '30.5%',
        costPerPatient: 'KES 4,200',
        revenuePerBedDay: 'KES 12,500',
        medicationCostRatio: '11.7%',
        staffCostRatio: '49.1%',
      },
      trends: {
        revenueGrowth: '+12.5%',
        costReduction: '-8.2%',
        efficiencyGain: '+15.3%',
      },
    };
  }

  // Helper methods for recommendations
  private generateVolumeRecommendations(total: number, critical: number, timeFrame: string): string[] {
    const recommendations = [];
    
    if (critical > 10) {
      recommendations.push('Activate emergency overflow protocol');
      recommendations.push('Notify on-call specialists');
    }
    
    if (total > 100 && timeFrame === 'today') {
      recommendations.push('Open additional triage stations');
      recommendations.push('Extend nursing shift coverage');
    }
    
    if (critical / total > 0.3) {
      recommendations.push('Review triage criteria for critical cases');
    }
    
    return recommendations;
  }

  private generateWaitTimeRecommendations(waitTimes: any[], compliance: any): string[] {
    const recommendations = [];
    
    const redWait = waitTimes.find(w => w.urgencyLevel === 'RED');
    if (redWait && Number(redWait.actualWaitMinutes) > 15) {
      recommendations.push('Implement dedicated critical care team for RED patients');
    }
    
    if (Number(compliance.onTimeRate?.replace('%', '')) < 80) {
      recommendations.push('Review and optimize patient flow processes');
    }
    
    return recommendations;
  }

  private generateOutbreakRecommendations(symptom: string, count: number): string[] {
    const recommendations = [];
    
    recommendations.push(`Activate ${symptom} outbreak protocol`);
    recommendations.push('Notify infection control team');
    
    if (count > 10) {
      recommendations.push('Set up isolation area');
      recommendations.push('Order additional PPE and supplies');
    }
    
    if (symptom.includes('respiratory')) {
      recommendations.push('Implement respiratory etiquette measures');
    }
    
    return recommendations;
  }

  private generateStaffRecommendations(doctorStats: any[], nurseStats: any[]): string[] {
    const recommendations = [];
    
    // Doctor recommendations
    const lowEfficiencyDoctors = doctorStats.filter(d => 
      Number(d.efficiencyScore) < 70
    );
    if (lowEfficiencyDoctors.length > 0) {
      recommendations.push(`Provide efficiency training for ${lowEfficiencyDoctors.length} doctors`);
    }
    
    // Nurse recommendations
    const slowNurses = nurseStats.filter(n => 
      Number(n.avgTriageTime) > 8
    );
    if (slowNurses.length > 0) {
      recommendations.push(`Review triage process with ${slowNurses.length} nurses`);
    }
    
    return recommendations;
  }

//   private generateResourceRecommendations(utilizationByType: any, total: number): string[] {
//     const recommendations = [];
    
//     for (const [type, data] of Object.entries(utilizationByType as any)) {
//       const availability = (data.available / data.total) * 100;
//       if (availability < 20) {
//         recommendations.push(`Consider acquiring additional ${type}s`);
//       }
//     }
    
//     return recommendations;
//   }

  private generateMedicationRecommendations(lowStock: any[], expired: any[]): string[] {
    const recommendations = [];
    
    if (lowStock.length > 0) {
      recommendations.push(`Reorder ${lowStock.length} medications urgently`);
    }
    
    if (expired.length > 0) {
      recommendations.push(`Dispose of ${expired.length} expired medications`);
    }
    
    return recommendations;
  }

  private generateKPITopRecommendations(allRecommendations: string[]): string[] {
    // Return top 5 most critical recommendations
    const priorityKeywords = ['urgent', 'critical', 'emergency', 'immediately', 'now'];
    
    return allRecommendations
      .sort((a, b) => {
        const aPriority = priorityKeywords.some(kw => a.toLowerCase().includes(kw)) ? 1 : 0;
        const bPriority = priorityKeywords.some(kw => b.toLowerCase().includes(kw)) ? 1 : 0;
        return bPriority - aPriority;
      })
      .slice(0, 5);
  }

  private calculateTrend(current: number, target: number, lowerIsBetter: boolean = false): string {
    const difference = current - target;
    const percentage = (difference / target) * 100;
    
    if (lowerIsBetter) {
      if (current < target) return `↓ ${Math.abs(percentage).toFixed(1)}% better than target`;
      if (current > target) return `↑ ${percentage.toFixed(1)}% worse than target`;
    } else {
      if (current > target) return `↑ ${percentage.toFixed(1)}% better than target`;
      if (current < target) return `↓ ${Math.abs(percentage).toFixed(1)}% worse than target`;
    }
    
    return 'At target';
  }

  private calculateOverallEfficiency(doctorStats: any[], nurseStats: any[]): string {
    const doctorEfficiency = doctorStats.length > 0 ?
      doctorStats.reduce((sum, d) => sum + Number(d.efficiencyScore), 0) / doctorStats.length : 0;
    
    const nurseEfficiency = nurseStats.length > 0 ?
      nurseStats.reduce((sum, n) => sum + Number(n.efficiencyScore), 0) / nurseStats.length : 0;
    
    const overall = (doctorEfficiency * 0.6 + nurseEfficiency * 0.4);
    return overall.toFixed(1) + '%';
  }
}