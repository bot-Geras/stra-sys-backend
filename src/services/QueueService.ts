import { db, sql, gte } from '../db';
import { departmentQueues, departments, patients, users, triageSessions } from '../db/schema';
import { eq, and, desc, asc, count, inArray } from 'drizzle-orm';
import { AppError } from '../middleware/error';
import { logger } from '../config/logger';
import { RedisService } from './RedisService';
import { SocketService } from './SocketService';

export class QueueService {
  private redisService: RedisService;
  private socketService: SocketService;

  constructor() {
    this.redisService = new RedisService();
    this.socketService = SocketService.getInstance();
  }

  async getQueueStatus(departmentId: string): Promise<any> {
    try {
      const cacheKey = `queue:${departmentId}`;
      const cached = await this.redisService.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      const queue = await db
        .select({
          queueId: departmentQueues.queueId,
          patientId: departmentQueues.patientId,
          straId: patients.straId,
          patientName: sql<string>`CONCAT(${patients.firstName}, ' ', ${patients.lastName})`,
          urgencyLevel: departmentQueues.urgencyLevel,
          positionInQueue: departmentQueues.positionInQueue,
          expectedWaitTime: departmentQueues.expectedWaitTime,
          status: departmentQueues.status,
          calledAt: departmentQueues.calledAt,
          assignedDoctor: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
          triageScore: triageSessions.triageScore,
          chiefComplaint: triageSessions.chiefComplaint,
        })
        .from(departmentQueues)
        .leftJoin(patients, eq(departmentQueues.patientId, patients.patientId))
        .leftJoin(users, eq(departmentQueues.assignedDoctorId, users.userId))
        .leftJoin(triageSessions, eq(departmentQueues.triageSessionId, triageSessions.sessionId))
        .where(eq(departmentQueues.departmentId, departmentId))
        .orderBy(
          sql`CASE 
            WHEN ${departmentQueues.urgencyLevel} = 'RED' THEN 1
            WHEN ${departmentQueues.urgencyLevel} = 'YELLOW' THEN 2
            ELSE 3
          END`,
          asc(departmentQueues.positionInQueue)
        );

      const [department] = await db
        .select()
        .from(departments)
        .where(eq(departments.departmentId, departmentId));

      const waitingCount = queue.filter(q => q.status === 'WAITING').length;
      const inProgressCount = queue.filter(q => q.status === 'IN_PROGRESS').length;

      const result = {
        department: {
          name: department?.name,
          currentLoad: department?.currentPatientLoad,
          maxCapacity: department?.maxCapacity,
          utilization: department ? 
            Math.round((department.currentPatientLoad / department.maxCapacity) * 100) : 0,
        },
        summary: {
          total: queue.length,
          waiting: waitingCount,
          inProgress: inProgressCount,
          averageWaitTime: queue.length > 0 ? 
            Math.round(queue.reduce((sum, q) => sum + q.expectedWaitTime, 0) / queue.length) : 0,
        },
        patients: queue.map(q => ({
          queueId: q.queueId,
          straId: q.straId,
          patientName: q.patientName,
          urgencyLevel: q.urgencyLevel,
          position: q.positionInQueue,
          waitTime: q.expectedWaitTime,
          status: q.status,
          calledAt: q.calledAt,
          assignedDoctor: q.assignedDoctor,
          triageScore: q.triageScore,
          chiefComplaint: q.chiefComplaint,
        })),
      };

      // Cache for 30 seconds
      await this.redisService.set(cacheKey, result, 30);
      
      return result;
    } catch (error) {
      logger.error('Failed to get queue status:', error);
      throw new AppError('Failed to get queue status', 500);
    }
  }

  async callNextPatient(departmentId: string, doctorId: string): Promise<any> {
    try {
      return await db.transaction(async (tx) => {
        // Get next patient (prioritizing RED, then YELLOW, then GREEN)
        const [nextPatient] = await tx
          .select()
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
            asc(departmentQueues.positionInQueue)
          )
          .limit(1);

        if (!nextPatient) {
          throw new AppError('No patients in queue', 404);
        }

        // Update patient status
        const [updated] = await tx
          .update(departmentQueues)
          .set({
            status: 'IN_PROGRESS',
            calledAt: new Date(),
            assignedDoctorId: doctorId,
            updatedAt: new Date(),
          })
          .where(eq(departmentQueues.queueId, nextPatient.queueId))
          .returning();

        // Update department load
        await tx
          .update(departments)
          .set({
            currentPatientLoad: sql`${departments.currentPatientLoad} - 1`,
          })
          .where(eq(departments.departmentId, departmentId));

        // Get patient details
        const [patient] = await tx
          .select({
            straId: patients.straId,
            firstName: patients.firstName,
            lastName: patients.lastName,
            phoneNumber: patients.phoneNumber,
          })
          .from(patients)
          .where(eq(patients.patientId, nextPatient.patientId));

        // Broadcast update
        this.socketService.broadcastToDepartment(departmentId, 'queue_update', {
          action: 'patient_called',
          queueId: updated?.queueId,
          patientId: updated?.patientId,
          straId: patient?.straId,
          patientName: `${patient?.firstName} ${patient?.lastName}`,
          doctorId,
          calledAt: updated?.calledAt,
        });

        // Clear cache
        await this.redisService.del(`queue:${departmentId}`);

        return {
          ...updated,
          patient,
        };
      });
    } catch (error) {
      logger.error('Failed to call next patient:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to call next patient', 500);
    }
  }

  async completePatient(queueId: string): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        const [queueEntry] = await tx
          .select()
          .from(departmentQueues)
          .where(eq(departmentQueues.queueId, queueId));

        if (!queueEntry) {
          throw new AppError('Queue entry not found', 404);
        }

        await tx
          .update(departmentQueues)
          .set({
            status: 'COMPLETED',
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(departmentQueues.queueId, queueId));

        // Broadcast update
        this.socketService.broadcastToDepartment(
          queueEntry.departmentId, 
          'queue_update', 
          { action: 'patient_completed', queueId }
        );

        // Clear cache
        await this.redisService.del(`queue:${queueEntry.departmentId}`);
      });
    } catch (error) {
      logger.error('Failed to complete patient:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to complete patient', 500);
    }
  }

  async skipPatient(queueId: string, reason: string): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        const [queueEntry] = await tx
          .select()
          .from(departmentQueues)
          .where(eq(departmentQueues.queueId, queueId));

        if (!queueEntry) {
          throw new AppError('Queue entry not found', 404);
        }

        await tx
          .update(departmentQueues)
          .set({
            status: 'SKIPPED',
            updatedAt: new Date(),
          })
          .where(eq(departmentQueues.queueId, queueId));

        // Move to another department or handle as needed
        logger.info(`Patient skipped: ${queueId}`, { reason });

        // Broadcast update
        this.socketService.broadcastToDepartment(
          queueEntry.departmentId, 
          'queue_update', 
          { action: 'patient_skipped', queueId, reason }
        );

        // Clear cache
        await this.redisService.del(`queue:${queueEntry.departmentId}`);
      });
    } catch (error) {
      logger.error('Failed to skip patient:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to skip patient', 500);
    }
  }

  async updatePatientPosition(queueId: string, newPosition: number): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        const [queueEntry] = await tx
          .select()
          .from(departmentQueues)
          .where(eq(departmentQueues.queueId, queueId));

        if (!queueEntry) {
          throw new AppError('Queue entry not found', 404);
        }

        // Get all waiting patients in the department
        const waitingPatients = await tx
          .select({
            queueId: departmentQueues.queueId,
            positionInQueue: departmentQueues.positionInQueue,
          })
          .from(departmentQueues)
          .where(
            and(
              eq(departmentQueues.departmentId, queueEntry.departmentId),
              eq(departmentQueues.status, 'WAITING'),
              sql`${departmentQueues.queueId} != ${queueId}`
            )
          )
          .orderBy(asc(departmentQueues.positionInQueue));

        // Adjust positions
        const positions = [];
        let currentPos = 1;

        for (let i = 0; i < waitingPatients.length; i++) {
          if (currentPos === newPosition) {
            positions.push({ queueId, position: currentPos });
            currentPos++;
          }
          positions.push({ 
            queueId: waitingPatients[i]?.queueId, 
            position: currentPos 
          });
          currentPos++;
        }

        if (currentPos <= newPosition) {
          positions.push({ queueId, position: newPosition });
        }

        // Update all positions
        for (const pos of positions) {
          await tx
            .update(departmentQueues)
            .set({
              positionInQueue: pos.position,
              updatedAt: new Date(),
            })
            .where(eq(departmentQueues.queueId, pos.queueId!));
        }

        // Broadcast update
        this.socketService.broadcastToDepartment(
          queueEntry.departmentId, 
          'queue_update', 
          { action: 'position_updated', queueId, newPosition }
        );

        // Clear cache
        await this.redisService.del(`queue:${queueEntry.departmentId}`);

        logger.info(`Patient position updated: ${queueId} -> position ${newPosition}`);
      });
    } catch (error) {
      logger.error('Failed to update patient position:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to update patient position', 500);
    }
  }

  async getQueueStatistics(departmentId?: string): Promise<any> {
    try {
      let whereClause = sql`1=1`;
      if (departmentId) {
        whereClause = eq(departmentQueues.departmentId, departmentId);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const stats = await db
        .select({
          totalPatients: count(),
          avgWaitTime: sql<number>`AVG(${departmentQueues.expectedWaitTime})`,
          avgActualWaitTime: sql<number>`AVG(
            EXTRACT(EPOCH FROM (${departmentQueues.completedAt} - ${departmentQueues.calledAt}))/60
          )`,
          byUrgency: sql`json_build_object(
            'RED', COUNT(CASE WHEN ${departmentQueues.urgencyLevel} = 'RED' THEN 1 END),
            'YELLOW', COUNT(CASE WHEN ${departmentQueues.urgencyLevel} = 'YELLOW' THEN 1 END),
            'GREEN', COUNT(CASE WHEN ${departmentQueues.urgencyLevel} = 'GREEN' THEN 1 END)
          )`,
          byStatus: sql`json_build_object(
            'WAITING', COUNT(CASE WHEN ${departmentQueues.status} = 'WAITING' THEN 1 END),
            'IN_PROGRESS', COUNT(CASE WHEN ${departmentQueues.status} = 'IN_PROGRESS' THEN 1 END),
            'COMPLETED', COUNT(CASE WHEN ${departmentQueues.status} = 'COMPLETED' THEN 1 END)
          )`,
        })
        .from(departmentQueues)
        .where(
          and(
            whereClause,
            gte(departmentQueues.createdAt, today)
          )
        );

      return stats[0] || {
        totalPatients: 0,
        avgWaitTime: 0,
        avgActualWaitTime: 0,
        byUrgency: { RED: 0, YELLOW: 0, GREEN: 0 },
        byStatus: { WAITING: 0, IN_PROGRESS: 0, COMPLETED: 0 },
      };
    } catch (error) {
      logger.error('Failed to get queue statistics:', error);
      throw new AppError('Failed to get queue statistics', 500);
    }
  }
}