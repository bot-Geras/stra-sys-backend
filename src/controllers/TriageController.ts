import { Request, Response } from 'express';
import { TriageService } from '../services/TriageService';
import { QueueService } from '../services/QueueService';
import { validate } from '../middleware/validation';
import { 
  patientRegistrationSchema, 
  triageSchema, 
  queueUpdateSchema 
} from '../utils/validators';
import { AppError } from '../middleware/error';

const triageService = new TriageService();
const queueService = new QueueService();

export class TriageController {
  async registerPatient(req: Request, res: Response) {
    try {
      const patientData = patientRegistrationSchema.parse(req.body);
      const patient = await triageService.registerPatient(patientData);
      
      res.status(201).json({
        success: true,
        data: patient,
        message: 'Patient registered successfully',
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

  async performTriage(req: Request, res: Response) {
    try {
      const triageData = triageSchema.parse(req.body);
      const result = await triageService.performTriage(triageData);
      
      res.status(201).json({
        success: true,
        data: result,
        message: 'Triage completed successfully',
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

  async getPatientDetails(req: Request, res: Response) {
    try {
      const { patientId } = req.params;
      const details = await triageService.getPatientDetails(patientId);
      
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

  async getQueue(req: Request, res: Response) {
    try {
      const { departmentId } = req.params;
      const queue = await queueService.getQueueStatus(departmentId);
      
      res.json({
        success: true,
        data: queue,
        message: 'Queue retrieved successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async callNextPatient(req: Request, res: Response) {
    try {
      const { departmentId } = req.params;
      const { doctorId } = req.body;
      
      if (!doctorId) {
        throw new AppError('Doctor ID is required', 400);
      }
      
      const nextPatient = await queueService.callNextPatient(departmentId, doctorId);
      
      res.json({
        success: true,
        data: nextPatient,
        message: 'Patient called successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async completePatient(req: Request, res: Response) {
    try {
      const { queueId } = req.params;
      await queueService.completePatient(queueId);
      
      res.json({
        success: true,
        message: 'Patient treatment completed',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async updateQueuePosition(req: Request, res: Response) {
    try {
      const { queueId } = req.params;
      const { position } = queueUpdateSchema.parse(req.body);
      
      await queueService.updatePatientPosition(queueId, position);
      
      res.json({
        success: true,
        message: 'Queue position updated successfully',
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

  async prioritizeQueue(req: Request, res: Response) {
    try {
      const { departmentId } = req.params;
      await triageService.prioritizeCriticalPatients(departmentId);
      
      res.json({
        success: true,
        message: 'Queue prioritized successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getStatistics(req: Request, res: Response) {
    try {
      const { timeFrame = 'today' } = req.query;
      const stats = await triageService.getTriageStatistics(timeFrame as any);
      
      res.json({
        success: true,
        data: stats,
        message: 'Statistics retrieved successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }
}