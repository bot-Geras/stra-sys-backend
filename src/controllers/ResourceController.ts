import { Request, Response } from 'express';
import { ResourceService } from '../services/ResourceService';
import { validate } from '../middleware/validation';
import { resourceAllocationSchema, maintenanceSchema } from '../utils/validators';

const resourceService = new ResourceService();

export class ResourceController {
  async getDashboard(req: Request, res: Response) {
    try {
      const dashboard = await resourceService.getResourceDashboard();
      
      res.json({
        success: true,
        data: dashboard,
        message: 'Resource dashboard retrieved successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async allocateResource(req: Request, res: Response) {
    try {
      const { resourceId } = req.params;
      const { patientId } = resourceAllocationSchema.parse(req.body);
      
      const result = await resourceService.allocateResource(resourceId, patientId);
      
      res.json({
        success: true,
        data: result,
        message: 'Resource allocated successfully',
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

  async releaseResource(req: Request, res: Response) {
    try {
      const { resourceId } = req.params;
      const result = await resourceService.releaseResource(resourceId);
      
      res.json({
        success: true,
        data: result,
        message: 'Resource released successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async setMaintenance(req: Request, res: Response) {
    try {
      const { resourceId } = req.params;
      const maintenanceData = maintenanceSchema.parse(req.body);
      
      const result = await resourceService.setResourceMaintenance(resourceId, maintenanceData);
      
      res.json({
        success: true,
        data: result,
        message: 'Resource set to maintenance successfully',
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

  async getPredictiveLoad(req: Request, res: Response) {
    try {
      const { hours = 4 } = req.query;
      const hoursNum = parseInt(hours as string) || 4;
      
      const prediction = await resourceService.getPredictiveLoad(hoursNum);
      
      res.json({
        success: true,
        data: prediction,
        message: 'Predictive load analysis retrieved',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getResourceAvailability(req: Request, res: Response) {
    try {
      const { type, departmentId } = req.query;
      const dashboard = await resourceService.getResourceDashboard();
      
      let availableResources = dashboard.byType;
      
      if (type) {
        availableResources = dashboard.byType[type as string] || {};
      }
      
      res.json({
        success: true,
        data: {
          availableResources,
          timestamp: dashboard.timestamp,
        },
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }
}