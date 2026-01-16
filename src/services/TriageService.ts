import { db, sql } from '../db';
import { patients, triageSessions, departmentQueues, departments } from '../db/schema';
import { eq, and, desc, count, gt, lt, inArray } from 'drizzle-orm';
import { TriageCalculator } from '../utils/TriageCalculator';
import { NotificationService } from './NotificationService';
import { AppError } from '../middleware/error';
 import { logger } from '../config/logger';
import type { NewPatient, NewTriageSession } from '../db/schema';

export class TriageService {
  private notificationService: NotificationService;

  constructor() {
    this.notificationService = new NotificationService();
  }

  async registerPatient(patientData: Omit<NewPatient, 'straId'>): Promise<any> {
    try {
      // Generate STRA-ID
      const [lastPatient] = await db
        .select({ straId: patients.straId })
        .from(patients)
        .orderBy(desc(patients.createdAt))
        .limit(1);

      const nextId = lastPatient 
        ? parseInt(lastPatient.straId.split('-')[1]) + 1 
        : 1;
      const straId = `STRA-${nextId.toString().padStart(6, '0')}`;

      const [patient] = await db
        .insert(patients)
        .values({
          ...patientData,
          straId,
        })
        .returning();

      // Log activity
      logger.info(`Patient registered: ${straId}`, { patientId: patient.patientId });

      return patient;
    } catch (error) {
      logger.error('Patient registration failed:', error);
      throw new AppError('Failed to register patient', 500);
    }
  }

  async performTriage(triageData: {
    patientId: string;
    nurseId: string;
    vitals: {
      temperature?: number;
      systolicBp?: number;
      diastolicBp?: number;
      heartRate?: number;
      respiratoryRate?: number;
      oxygenSaturation?: number;
      bloodGlucose?: number;
      painScale: number;
      weight?: number;
      height?: number;
    };
    symptoms: Record<string, any>;
    chiefComplaint?: string;
  }): Promise<{ triage: any; queue: any }> {
    try {
      // Calculate MEWS score
      const mewsScore = TriageCalculator.calculateMEWS({
        respiratoryRate: triageData.vitals.respiratoryRate || 0,
        oxygenSaturation: triageData.vitals.oxygenSaturation || 0,
        temperature: triageData.vitals.temperature || 0,
        systolicBP: triageData.vitals.systolicBp || 0,
        heartRate: triageData.vitals.heartRate || 0,
      });

      const urgencyLevel = TriageCalculator.getUrgencyLevel(mewsScore);
      
      // Determine department
      const recommendedDept = await this.determineDepartment(
        triageData.symptoms,
        triageData.vitals
      );

      // Get department
      const [department] = await db
        .select()
        .from(departments)
        .where(eq(departments.name, recommendedDept));

      if (!department) {
        throw new AppError('Department not found', 404);
      }

      // Get queue length
      const [queueCount] = await db
        .select({ count: count() })
        .from(departmentQueues)
        .where(
          and(
            eq(departmentQueues.departmentId, department.departmentId),
            eq(departmentQueues.status, 'WAITING')
          )
        );

      // Calculate BMI if weight and height provided
      let bmi = undefined;
      if (triageData.vitals.weight && triageData.vitals.height) {
        const heightInMeters = triageData.vitals.height / 100;
        bmi = triageData.vitals.weight / (heightInMeters * heightInMeters);
      }

      const estimatedWait = TriageCalculator.estimateWaitTime(
        urgencyLevel,
        Number(queueCount?.count || 0),
        department.averageTreatmentTime
      );

      // Create triage session and queue entry in transaction
      const result = await db.transaction(async (tx) => {
        // Insert triage session
        const [triageSession] = await tx
          .insert(triageSessions)
          .values({
            patientId: triageData.patientId,
            nurseId: triageData.nurseId,
            ...triageData.vitals,
            bmi,
            symptoms: triageData.symptoms,
            chiefComplaint: triageData.chiefComplaint,
            triageScore: mewsScore,
            urgencyLevel,
            recommendedDept,
            estimatedWaitMinutes: estimatedWait,
          })
          .returning();

        // Add to queue
        const queuePosition = Number(queueCount?.count || 0) + 1;
        const [queueEntry] = await tx
          .insert(departmentQueues)
          .values({
            departmentId: department.departmentId,
            patientId: triageData.patientId,
            triageSessionId: triageSession.sessionId,
            urgencyLevel,
            positionInQueue: queuePosition,
            expectedWaitTime: estimatedWait,
            status: 'WAITING',
          })
          .returning();

        // Update department load
        await tx
          .update(departments)
          .set({
            currentPatientLoad: sql`${departments.currentPatientLoad} + 1`,
          })
          .where(eq(departments.departmentId, department.departmentId));

        return { triageSession, queueEntry };
      });

      // Send notifications for critical cases
      if (urgencyLevel === 'RED') {
        const [patient] = await db
          .select()
          .from(patients)
          .where(eq(patients.patientId, triageData.patientId));

        if (patient) {
          await this.notificationService.sendCriticalAlert({
            patientId: triageData.patientId,
            straId: patient.straId,
            patientName: `${patient.firstName} ${patient.lastName}`,
            department: recommendedDept,
            mewsScore,
            vitalSigns: triageData.vitals,
          });
        }
      }

      logger.info(`Triage completed for patient ${triageData.patientId}`, {
        urgencyLevel,
        mewsScore,
        department: recommendedDept,
      });

      return {
        triage: result.triageSession,
        queue: result.queueEntry,
      };
    } catch (error) {
      logger.error('Triage failed:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to perform triage', 500);
    }
  }

  async getPatientQueue(departmentId: string): Promise<any[]> {
    try {
      const queue = await db
        .select({
          queueId: departmentQueues.queueId,
          positionInQueue: departmentQueues.positionInQueue,
          urgencyLevel: departmentQueues.urgencyLevel,
          expectedWaitTime: departmentQueues.expectedWaitTime,
          status: departmentQueues.status,
          calledAt: departmentQueues.calledAt,
          patient: {
            patientId: patients.patientId,
            straId: patients.straId,
            firstName: patients.firstName,
            lastName: patients.lastName,
            age: sql<number>`EXTRACT(YEAR FROM AGE(${patients.dateOfBirth}))`,
            gender: patients.gender,
          },
          triage: {
            triageScore: triageSessions.triageScore,
            chiefComplaint: triageSessions.chiefComplaint,
          },
        })
        .from(departmentQueues)
        .leftJoin(patients, eq(departmentQueues.patientId, patients.patientId))
        .leftJoin(triageSessions, eq(departmentQueues.triageSessionId, triageSessions.sessionId))
        .where(
          and(
            eq(departmentQueues.departmentId, departmentId),
            eq(departmentQueues.status, 'WAITING')
          )
        )
        .orderBy(
          sql`CASE 
            WHEN ${departmentQueues.urgencyLevel} = 'RED' THEN 1
            WHEN ${departmentQueues.urgencyLevel} = 'YELLOW' THEN 2
            ELSE 3
          END`,
          departmentQueues.positionInQueue
        );

      return queue;
    } catch (error) {
      logger.error('Failed to fetch queue:', error);
      throw new AppError('Failed to fetch queue', 500);
    }
  }

  async getPatientDetails(patientId: string): Promise<any> {
    try {
      const [patient] = await db
        .select()
        .from(patients)
        .where(eq(patients.patientId, patientId));

      if (!patient) {
        throw new AppError('Patient not found', 404);
      }

      // Get latest triage session
      const [latestTriage] = await db
        .select()
        .from(triageSessions)
        .where(eq(triageSessions.patientId, patientId))
        .orderBy(desc(triageSessions.createdAt))
        .limit(1);

      // Get recent vitals history (last 5)
      const recentVitals = await db
        .select()
        .from(vitalsHistory)
        .where(eq(vitalsHistory.patientId, patientId))
        .orderBy(desc(vitalsHistory.createdAt))
        .limit(5);

      // Get current queue status
      const [currentQueue] = await db
        .select()
        .from(departmentQueues)
        .where(
          and(
            eq(departmentQueues.patientId, patientId),
            inArray(departmentQueues.status, ['WAITING', 'IN_PROGRESS'])
          )
        )
        .limit(1);

      // Calculate age
      const age = Math.floor(
        (new Date().getTime() - new Date(patient.dateOfBirth).getTime()) / 
        (365.25 * 24 * 60 * 60 * 1000)
      );

      return {
        patient: {
          ...patient,
          age,
        },
        latestTriage,
        recentVitals,
        currentQueue,
      };
    } catch (error) {
      logger.error('Failed to fetch patient details:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to fetch patient details', 500);
    }
  }

  async updateQueuePosition(queueId: string, position: number): Promise<void> {
    try {
      await db
        .update(departmentQueues)
        .set({
          positionInQueue: position,
          updatedAt: new Date(),
        })
        .where(eq(departmentQueues.queueId, queueId));

      logger.info(`Queue position updated: ${queueId} -> position ${position}`);
    } catch (error) {
      logger.error('Failed to update queue position:', error);
      throw new AppError('Failed to update queue position', 500);
    }
  }

  async prioritizeCriticalPatients(departmentId: string): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        // Get all waiting patients ordered by urgency and arrival time
        const waitingPatients = await tx
          .select({
            queueId: departmentQueues.queueId,
            urgencyLevel: departmentQueues.urgencyLevel,
            createdAt: departmentQueues.createdAt,
          })
          .from(departmentQueues)
          .where(
            and(
              eq(departmentQueues.departmentId, departmentId),
              eq(departmentQueues.status, 'WAITING')
            )
          )
          .orderBy(
            sql`CASE 
              WHEN ${departmentQueues.urgencyLevel} = 'RED' THEN 1
              WHEN ${departmentQueues.urgencyLevel} = 'YELLOW' THEN 2
              ELSE 3
            END`,
            departmentQueues.createdAt
          );

        // Update positions
        for (let i = 0; i < waitingPatients.length; i++) {
          await tx
            .update(departmentQueues)
            .set({
              positionInQueue: i + 1,
              updatedAt: new Date(),
            })
            .where(eq(departmentQueues.queueId, waitingPatients[i].queueId));
        }

        logger.info(`Queue prioritized for department ${departmentId}`, {
          totalPatients: waitingPatients.length,
        });
      });
    } catch (error) {
      logger.error('Failed to prioritize queue:', error);
      throw new AppError('Failed to prioritize queue', 500);
    }
  }

  private async determineDepartment(
    symptoms: Record<string, any>,
    vitals: any
  ): Promise<string> {
    // Enhanced department determination logic
    if (vitals.oxygenSaturation < 92 || symptoms.chest_pain) {
      return 'Emergency/Cardiology';
    }
    
    if (symptoms.head_trauma || symptoms.seizure || symptoms.stroke_symptoms) {
      return 'Emergency/Neurology';
    }
    
    if (symptoms.abdominal_pain || symptoms.gastrointestinal_bleeding) {
      return 'Emergency/Surgery';
    }
    
    if (symptoms.fever && (symptoms.cough || symptoms.shortness_of_breath)) {
      return 'Emergency/Infectious Diseases';
    }
    
    if (symptoms.burn || symptoms.trauma) {
      return 'Emergency/Trauma';
    }
    
    if (symptoms.pediatric && patient.age < 12) {
      return 'Pediatrics';
    }
    
    return 'Emergency/General';
  }

  async getTriageStatistics(timeFrame: 'today' | 'week' | 'month'): Promise<any> {
    try {
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

      const stats = await db
        .select({
          urgencyLevel: triageSessions.urgencyLevel,
          count: count(),
          avgWaitTime: sql<number>`AVG(${departmentQueues.expectedWaitTime})`,
        })
        .from(triageSessions)
        .leftJoin(departmentQueues, eq(triageSessions.sessionId, departmentQueues.triageSessionId))
        .where(gt(triageSessions.createdAt, startDate))
        .groupBy(triageSessions.urgencyLevel);

      const total = await db
        .select({ count: count() })
        .from(triageSessions)
        .where(gt(triageSessions.createdAt, startDate));

      return {
        timeFrame,
        startDate,
        total: total[0]?.count || 0,
        byUrgency: stats,
      };
    } catch (error) {
      logger.error('Failed to fetch triage statistics:', error);
      throw new AppError('Failed to fetch statistics', 500);
    }
  }
}