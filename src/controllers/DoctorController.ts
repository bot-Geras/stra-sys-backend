import { Request, Response } from 'express';
import { DoctorService } from '../services/DoctorService';
import { validate } from '../middleware/validation';
import { 
  labOrderSchema, 
  prescriptionSchema,
  vitalSignsSchema
} from '../utils/validators';

const doctorService = new DoctorService();

export class DoctorController {
  async getDoctorQueue(req: Request, res: Response) {
    try {
      // @ts-ignore - user is added by auth middleware
      const doctorId = req.user.userId;
      const queue = await doctorService.getDoctorQueue(doctorId);
      
      res.json({
        success: true,
        data: queue,
        message: 'Doctor queue retrieved successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getPatientDetails(req: Request, res: Response) {
    try {
      const { patientId } = req.params;
      const details = await doctorService.getPatientDetails(patientId);
      
      res.json({
        success: true,
        data: details,
        message: 'Patient details retrieved successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async orderLabTests(req: Request, res: Response) {
    try {
      const data = labOrderSchema.parse(req.body);
      // @ts-ignore
      const doctorId = req.user.userId;
      
      const labOrder = await doctorService.orderLabTests({
        ...data,
        doctorId,
      });
      
      res.status(201).json({
        success: true,
        data: labOrder,
        message: 'Lab tests ordered successfully',
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({
          success: false,
          errors: error.errors,
        });
      } else {
        res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  async orderDiagnosticImaging(req: Request, res: Response) {
    try {
      const { patientId, modality, bodyPart, clinicalIndication, priority, notes } = req.body;
      // @ts-ignore
      const doctorId = req.user.userId;
      
      const imagingOrder = await doctorService.orderDiagnosticImaging({
        patientId,
        doctorId,
        modality,
        bodyPart,
        clinicalIndication,
        priority,
        notes,
      });
      
      res.status(201).json({
        success: true,
        data: imagingOrder,
        message: 'Diagnostic imaging ordered successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async createPrescription(req: Request, res: Response) {
    try {
      const data = prescriptionSchema.parse(req.body);
      // @ts-ignore
      const doctorId = req.user.userId;
      
      const prescription = await doctorService.createPrescription({
        ...data,
        doctorId,
        startDate: new Date(data.startDate || new Date()),
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      });
      
      res.status(201).json({
        success: true,
        data: prescription,
        message: 'Prescription created successfully',
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({
          success: false,
          errors: error.errors,
        });
      } else {
        res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  async updatePatientDisposition(req: Request, res: Response) {
    try {
      const { patientId } = req.params;
      const { action, departmentId, ward, bedNumber, dischargeInstructions, followUpDate, notes } = req.body;
      
      await doctorService.updatePatientDisposition(patientId, {
        action,
        departmentId,
        ward,
        bedNumber,
        dischargeInstructions,
        followUpDate: followUpDate ? new Date(followUpDate) : undefined,
        notes,
      });
      
      res.json({
        success: true,
        message: `Patient ${action.toLowerCase()} completed successfully`,
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async recordVitalSigns(req: Request, res: Response) {
    try {
      const { patientId } = req.params;
      const data = vitalSignsSchema.parse(req.body);
      // @ts-ignore
      const recordedBy = req.user.userId;
      
      const vitalRecord = await doctorService.recordVitalSigns({
        ...data,
        patientId,
        recordedBy,
      });
      
      res.status(201).json({
        success: true,
        data: vitalRecord,
        message: 'Vital signs recorded successfully',
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({
          success: false,
          errors: error.errors,
        });
      } else {
        res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
        });
      }
    }
  }

  async getDoctorStatistics(req: Request, res: Response) {
    try {
      // @ts-ignore
      const doctorId = req.user.userId;
      const { timeFrame = 'week' } = req.query;
      
      const statistics = await doctorService.getDoctorStatistics(
        doctorId, 
        timeFrame as any
      );
      
      res.json({
        success: true,
        data: statistics,
        message: 'Doctor statistics retrieved successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getPatientLabResults(req: Request, res: Response) {
    try {
      const { patientId } = req.params;
      // In production, this would fetch from a lab system
      // For now, return mock data
      
      const mockResults = [
        {
          testName: 'Complete Blood Count',
          result: 'Within normal limits',
          date: new Date().toISOString(),
          status: 'COMPLETED',
        },
        {
          testName: 'Basic Metabolic Panel',
          result: 'Normal',
          date: new Date().toISOString(),
          status: 'COMPLETED',
        },
      ];
      
      res.json({
        success: true,
        data: mockResults,
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }
}