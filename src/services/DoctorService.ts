import { db, sql } from '../db';
import { 
  doctorAssignments, labOrders, prescriptions, diagnosticImaging,
  patients, users, departmentQueues, vitalsHistory, triageSessions 
} from '../db/schema';
import { eq, and, desc, asc, count, inArray, gte, lte } from 'drizzle-orm';
import { AppError } from '../middleware/error';
import { logger } from '../config/logger';
import { RedisService } from './RedisService';

export class DoctorService {
  private redisService: RedisService;

  constructor() {
    this.redisService = new RedisService();
  }

  async getDoctorQueue(doctorId: string): Promise<any[]> {
    try {
      const cacheKey = `doctor_queue:${doctorId}`;
      const cached = await this.redisService.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      // Get active assignments
      const assignments = await db
        .select({
          assignmentId: doctorAssignments.assignmentId,
          patientId: doctorAssignments.patientId,
          straId: patients.straId,
          patientName: sql<string>`CONCAT(${patients.firstName}, ' ', ${patients.lastName})`,
          age: sql<number>`EXTRACT(YEAR FROM AGE(${patients.dateOfBirth}))`,
          gender: patients.gender,
          urgencyLevel: departmentQueues.urgencyLevel,
          chiefComplaint: triageSessions.chiefComplaint,
          assignedAt: doctorAssignments.assignedAt,
          status: doctorAssignments.status,
        })
        .from(doctorAssignments)
        .leftJoin(patients, eq(doctorAssignments.patientId, patients.patientId))
        .leftJoin(departmentQueues, eq(doctorAssignments.patientId, departmentQueues.patientId))
        .leftJoin(triageSessions, eq(departmentQueues.triageSessionId, triageSessions.sessionId))
        .where(
          and(
            eq(doctorAssignments.doctorId, doctorId),
            eq(doctorAssignments.status, 'ACTIVE'),
            inArray(departmentQueues.status, ['IN_PROGRESS', 'WAITING'])
          )
        )
        .orderBy(desc(doctorAssignments.assignedAt));

      // Cache for 1 minute
      await this.redisService.set(cacheKey, assignments, 60);
      
      return assignments;
    } catch (error) {
      logger.error('Failed to get doctor queue:', error);
      throw new AppError('Failed to get doctor queue', 500);
    }
  }

  async getPatientDetails(patientId: string): Promise<any> {
    try {
      const cacheKey = `patient_details:${patientId}`;
      const cached = await this.redisService.get(cacheKey);
      
      if (cached) {
        return cached;
      }

      // Get patient info
      const [patient] = await db
        .select()
        .from(patients)
        .where(eq(patients.patientId, patientId));

      if (!patient) {
        throw new AppError('Patient not found', 404);
      }

      // Get latest triage
      const [latestTriage] = await db
        .select()
        .from(triageSessions)
        .where(eq(triageSessions.patientId, patientId))
        .orderBy(desc(triageSessions.createdAt))
        .limit(1);

      // Get vital history
      const vitalsHistoryData = await db
        .select()
        .from(vitalsHistory)
        .where(eq(vitalsHistory.patientId, patientId))
        .orderBy(desc(vitalsHistory.createdAt))
        .limit(10);

      // Get prescriptions
      const prescriptionsData = await db
        .select({
          prescriptionId: prescriptions.prescriptionId,
          medications: prescriptions.medications,
          diagnosis: prescriptions.diagnosis,
          startDate: prescriptions.startDate,
          endDate: prescriptions.endDate,
          isDispensed: prescriptions.isDispensed,
          doctorName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
          createdAt: prescriptions.createdAt,
        })
        .from(prescriptions)
        .leftJoin(users, eq(prescriptions.doctorId, users.userId))
        .where(eq(prescriptions.patientId, patientId))
        .orderBy(desc(prescriptions.createdAt))
        .limit(10);

      // Get lab orders
      const labOrdersData = await db
        .select({
          orderId: labOrders.orderId,
          tests: labOrders.tests,
          status: labOrders.status,
          results: labOrders.results,
          orderedAt: labOrders.orderedAt,
          completedAt: labOrders.completedAt,
          doctorName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
        })
        .from(labOrders)
        .leftJoin(users, eq(labOrders.doctorId, users.userId))
        .where(eq(labOrders.patientId, patientId))
        .orderBy(desc(labOrders.orderedAt))
        .limit(10);

      // Calculate age
      const age = Math.floor(
        (new Date().getTime() - new Date(patient.dateOfBirth).getTime()) / 
        (365.25 * 24 * 60 * 60 * 1000)
      );

      const result = {
        patient: {
          ...patient,
          age,
        },
        latestTriage,
        vitalsHistory: vitalsHistoryData,
        prescriptions: prescriptionsData,
        labOrders: labOrdersData,
        summary: {
          totalVisits: vitalsHistoryData.length,
          activePrescriptions: prescriptionsData.filter(p => !p.isDispensed).length,
          pendingTests: labOrdersData.filter(l => l.status !== 'COMPLETED').length,
        },
      };

      // Cache for 5 minutes
      await this.redisService.set(cacheKey, result, 300);
      
      return result;
    } catch (error) {
      logger.error('Failed to get patient details:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to get patient details', 500);
    }
  }

  async orderLabTests(data: {
    patientId: string;
    doctorId: string;
    tests: Array<{
      testCode: string;
      testName: string;
      specimenType: string;
      urgency: 'ROUTINE' | 'URGENT' | 'STAT';
      instructions?: string;
    }>;
    notes?: string;
  }): Promise<any> {
    try {
      const [labOrder] = await db
        .insert(labOrders)
        .values({
          patientId: data.patientId,
          doctorId: data.doctorId,
          tests: data.tests,
          priority: data.tests.some(t => t.urgency === 'STAT') ? 'RED' : 
                   data.tests.some(t => t.urgency === 'URGENT') ? 'YELLOW' : 'GREEN',
          isCritical: data.tests.some(t => t.urgency === 'STAT'),
          notes: data.notes,
          orderedAt: new Date(),
        })
        .returning();

      // Clear caches
      await Promise.all([
        this.redisService.del(`patient_details:${data.patientId}`),
        this.redisService.del(`doctor_queue:${data.doctorId}`),
      ]);

      logger.info(`Lab tests ordered for patient ${data.patientId}`, {
        orderId: labOrder.orderId,
        testsCount: data.tests.length,
        doctorId: data.doctorId,
      });

      return labOrder;
    } catch (error) {
      logger.error('Failed to order lab tests:', error);
      throw new AppError('Failed to order lab tests', 500);
    }
  }

  async orderDiagnosticImaging(data: {
    patientId: string;
    doctorId: string;
    modality: string;
    bodyPart: string;
    clinicalIndication: string;
    priority?: 'GREEN' | 'YELLOW' | 'RED';
    notes?: string;
  }): Promise<any> {
    try {
      const [imagingOrder] = await db
        .insert(diagnosticImaging)
        .values({
          patientId: data.patientId,
          doctorId: data.doctorId,
          modality: data.modality,
          bodyPart: data.bodyPart,
          clinicalIndication: data.clinicalIndication,
          priority: data.priority || 'GREEN',
          notes: data.notes,
        })
        .returning();

      // Clear caches
      await this.redisService.del(`patient_details:${data.patientId}`);

      logger.info(`Diagnostic imaging ordered for patient ${data.patientId}`, {
        imagingId: imagingOrder.imagingId,
        modality: data.modality,
        doctorId: data.doctorId,
      });

      return imagingOrder;
    } catch (error) {
      logger.error('Failed to order diagnostic imaging:', error);
      throw new AppError('Failed to order diagnostic imaging', 500);
    }
  }

  async createPrescription(data: {
    patientId: string;
    doctorId: string;
    medications: Array<{
      medicationId: string;
      name: string;
      dosage: string;
      frequency: string;
      duration: string;
      instructions?: string;
    }>;
    diagnosis: string;
    instructions?: string;
    clinicalNotes?: string;
    startDate: Date;
    endDate?: Date;
    refillsAllowed?: number;
  }): Promise<any> {
    try {
      // Check for drug interactions
      const interactionWarnings = await this.checkDrugInteractions(data.medications);

      const [prescription] = await db
        .insert(prescriptions)
        .values({
          patientId: data.patientId,
          doctorId: data.doctorId,
          medications: data.medications,
          diagnosis: data.diagnosis,
          clinicalNotes: data.clinicalNotes,
          instructions: data.instructions,
          startDate: data.startDate,
          endDate: data.endDate,
          refillsAllowed: data.refillsAllowed || 0,
          refillsRemaining: data.refillsAllowed || 0,
        })
        .returning();

      // Clear caches
      await Promise.all([
        this.redisService.del(`patient_details:${data.patientId}`),
        this.redisService.del(`doctor_queue:${data.doctorId}`),
      ]);

      logger.info(`Prescription created for patient ${data.patientId}`, {
        prescriptionId: prescription.prescriptionId,
        medicationsCount: data.medications.length,
        doctorId: data.doctorId,
      });

      return {
        ...prescription,
        warnings: interactionWarnings,
      };
    } catch (error) {
      logger.error('Failed to create prescription:', error);
      throw new AppError('Failed to create prescription', 500);
    }
  }

  async updatePatientDisposition(patientId: string, data: {
    action: 'ADMIT' | 'DISCHARGE' | 'TRANSFER' | 'REFER';
    departmentId?: string;
    ward?: string;
    bedNumber?: string;
    dischargeInstructions?: string;
    followUpDate?: Date;
    notes?: string;
  }): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        // Update or end current assignment
        const [currentAssignment] = await tx
          .select()
          .from(doctorAssignments)
          .where(
            and(
              eq(doctorAssignments.patientId, patientId),
              eq(doctorAssignments.status, 'ACTIVE')
            )
          )
          .limit(1);

        if (currentAssignment) {
          await tx
            .update(doctorAssignments)
            .set({
              status: data.action === 'TRANSFER' ? 'TRANSFERRED' : 'COMPLETED',
              completedAt: new Date(),
              notes: data.notes,
            })
            .where(eq(doctorAssignments.assignmentId, currentAssignment.assignmentId));
        }

        // Update queue status
        const [queueEntry] = await tx
          .select()
          .from(departmentQueues)
          .where(
            and(
              eq(departmentQueues.patientId, patientId),
              inArray(departmentQueues.status, ['WAITING', 'IN_PROGRESS'])
            )
          )
          .limit(1);

        if (queueEntry) {
          await tx
            .update(departmentQueues)
            .set({
              status: 'COMPLETED',
              completedAt: new Date(),
            })
            .where(eq(departmentQueues.queueId, queueEntry.queueId));
        }

        // Create new assignment if transferring
        if (data.action === 'TRANSFER' || data.action === 'ADMIT') {
          await tx.insert(doctorAssignments).values({
            patientId,
            doctorId: currentAssignment?.doctorId,
            status: 'ACTIVE',
            assignedAt: new Date(),
            notes: `Transferred to ${data.departmentId}`,
          });
        }

        // Log disposition
        logger.info(`Patient disposition updated: ${patientId}`, {
          action: data.action,
          departmentId: data.departmentId,
          doctorId: currentAssignment?.doctorId,
        });
      });

      // Clear caches
      if (data.action === 'DISCHARGE') {
        await this.redisService.del(`patient_details:${patientId}`);
      }
    } catch (error) {
      logger.error('Failed to update patient disposition:', error);
      throw new AppError('Failed to update patient disposition', 500);
    }
  }

  async recordVitalSigns(data: {
    patientId: string;
    recordedBy: string;
    temperature?: number;
    systolicBp?: number;
    diastolicBp?: number;
    heartRate?: number;
    respiratoryRate?: number;
    oxygenSaturation?: number;
    bloodGlucose?: number;
    painScale?: number;
    weight?: number;
    height?: number;
    notes?: string;
  }): Promise<any> {
    try {
      // Calculate if critical
      const isCritical = this.isCriticalVitals(data);

      const [vitalRecord] = await db
        .insert(vitalsHistory)
        .values({
          ...data,
          isCritical,
        })
        .returning();

      // Clear patient details cache
      await this.redisService.del(`patient_details:${data.patientId}`);

      logger.info(`Vital signs recorded for patient ${data.patientId}`, {
        vitalId: vitalRecord.vitalId,
        isCritical,
        recordedBy: data.recordedBy,
      });

      return vitalRecord;
    } catch (error) {
      logger.error('Failed to record vital signs:', error);
      throw new AppError('Failed to record vital signs', 500);
    }
  }

  async getDoctorStatistics(doctorId: string, timeFrame: 'day' | 'week' | 'month'): Promise<any> {
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
      }

      const stats = await db
        .select({
          totalPatients: sql<number>`COUNT(DISTINCT ${doctorAssignments.patientId})`,
          avgConsultationTime: sql<number>`AVG(
            EXTRACT(EPOCH FROM (${doctorAssignments.completedAt} - ${doctorAssignments.startedAt}))/60
          )`,
          prescriptionsWritten: sql<number>`COUNT(DISTINCT ${prescriptions.prescriptionId})`,
          labTestsOrdered: sql<number>`COUNT(DISTINCT ${labOrders.orderId})`,
          completionRate: sql<number>`(
            COUNT(CASE WHEN ${doctorAssignments.status} = 'COMPLETED' THEN 1 END)::FLOAT / 
            NULLIF(COUNT(*), 0) * 100
          )`,
        })
        .from(doctorAssignments)
        .leftJoin(prescriptions, eq(doctorAssignments.patientId, prescriptions.patientId))
        .leftJoin(labOrders, eq(doctorAssignments.patientId, labOrders.patientId))
        .where(
          and(
            eq(doctorAssignments.doctorId, doctorId),
            gte(doctorAssignments.assignedAt, startDate)
          )
        );

      return {
        timeFrame,
        startDate,
        endDate: new Date(),
        statistics: stats[0] || {
          totalPatients: 0,
          avgConsultationTime: 0,
          prescriptionsWritten: 0,
          labTestsOrdered: 0,
          completionRate: 0,
        },
      };
    } catch (error) {
      logger.error('Failed to get doctor statistics:', error);
      throw new AppError('Failed to get doctor statistics', 500);
    }
  }

  private async checkDrugInteractions(medications: any[]): Promise<string[]> {
    const warnings: string[] = [];
    const medicationNames = medications.map(m => m.name.toLowerCase());

    // Common dangerous interactions (in production, use a proper drug interaction API)
    const dangerousCombinations = [
      {
        drugs: ['warfarin', 'aspirin', 'ibuprofen'],
        warning: 'Increased bleeding risk - monitor INR closely',
      },
      {
        drugs: ['simvastatin', 'atorvastatin', 'clarithromycin'],
        warning: 'Increased risk of rhabdomyolysis - monitor CPK',
      },
      {
        drugs: ['lisinopril', 'losartan', 'ibuprofen'],
        warning: 'Reduced antihypertensive effect and renal risk',
      },
      {
        drugs: ['metformin', 'contrast dye'],
        warning: 'Risk of lactic acidosis - withhold metformin before contrast',
      },
    ];

    for (const combination of dangerousCombinations) {
      const foundDrugs = combination.drugs.filter(drug =>
        medicationNames.some(name => name.includes(drug.toLowerCase()))
      );
      
      if (foundDrugs.length >= 2) {
        warnings.push(`${combination.warning}: ${foundDrugs.join(' + ')}`);
      }
    }

    // Check for duplicate therapeutic classes
    const therapeuticClasses = this.getTherapeuticClasses(medications);
    const duplicateClasses = this.findDuplicateClasses(therapeuticClasses);
    
    if (duplicateClasses.length > 0) {
      warnings.push(`Duplicate therapeutic classes: ${duplicateClasses.join(', ')}`);
    }

    return warnings;
  }

  private getTherapeuticClasses(medications: any[]): Map<string, string[]> {
    // Simplified therapeutic class mapping
    const classMap: Record<string, string[]> = {
      'antibiotic': ['amoxicillin', 'azithromycin', 'doxycycline', 'ciprofloxacin'],
      'antihypertensive': ['lisinopril', 'amlodipine', 'losartan', 'hydrochlorothiazide'],
      'analgesic': ['paracetamol', 'ibuprofen', 'diclofenac', 'tramadol'],
      'antidiabetic': ['metformin', 'glibenclamide', 'insulin'],
      'anticoagulant': ['warfarin', 'aspirin', 'clopidogrel'],
    };

    const result = new Map<string, string[]>();
    
    medications.forEach(med => {
      for (const [therapeuticClass, drugList] of Object.entries(classMap)) {
        if (drugList.some(drug => med.name.toLowerCase().includes(drug.toLowerCase()))) {
          if (!result.has(therapeuticClass)) {
            result.set(therapeuticClass, []);
          }
          result.get(therapeuticClass)!.push(med.name);
        }
      }
    });

    return result;
  }

  private findDuplicateClasses(classMap: Map<string, string[]>): string[] {
    const duplicates: string[] = [];
    
    for (const [therapeuticClass, drugs] of classMap.entries()) {
      if (drugs.length > 1) {
        duplicates.push(`${therapeuticClass} (${drugs.join(', ')})`);
      }
    }

    return duplicates;
  }

  private isCriticalVitals(vitals: any): boolean {
    // Critical vital sign thresholds
    if (vitals.oxygenSaturation && vitals.oxygenSaturation < 92) return true;
    if (vitals.systolicBp && (vitals.systolicBp < 90 || vitals.systolicBp > 180)) return true;
    if (vitals.heartRate && (vitals.heartRate < 40 || vitals.heartRate > 130)) return true;
    if (vitals.respiratoryRate && (vitals.respiratoryRate < 8 || vitals.respiratoryRate > 30)) return true;
    if (vitals.temperature && (vitals.temperature < 35 || vitals.temperature > 40)) return true;
    if (vitals.bloodGlucose && (vitals.bloodGlucose < 3 || vitals.bloodGlucose > 20)) return true;
    
    return false;
  }
}