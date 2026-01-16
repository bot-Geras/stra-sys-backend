import { Request, Response } from 'express';
import { InventoryService } from '../services/InventoryService';
import { validate } from '../middleware/validation';
import { z } from 'zod';

const inventoryService = new InventoryService();

const stockUpdateSchema = z.object({
  adjustment: z.number().int(),
  reason: z.string().min(1),
  notes: z.string().optional(),
  transactionType: z.enum(['RESTOCK', 'DISPENSE', 'ADJUSTMENT', 'WASTE']),
  referenceId: z.string().optional(),
});

export class InventoryController {
  async getMedicationStock(req: Request, res: Response) {
    try {
      const { search, lowStock, status, page, limit } = req.query;
      const result = await inventoryService.getMedicationStock({
        search: search as string,
        lowStock: lowStock === 'true',
        status: status as string,
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async updateStockLevel(req: Request, res: Response) {
    try {
      const { medicationId } = req.params;
      const validatedData = stockUpdateSchema.parse(req.body);
      
      const result = await inventoryService.updateStockLevel(medicationId, validatedData);
      
      res.json({
        success: true,
        data: result,
        message: 'Stock level updated successfully',
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
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

  async getLowStockAlerts(req: Request, res: Response) {
    try {
      const alerts = await inventoryService.getLowStockAlerts();
      
      res.json({
        success: true,
        data: alerts,
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getConsumptionAnalytics(req: Request, res: Response) {
    try {
      const { timeFrame = 'month' } = req.query;
      
      const analytics = await inventoryService.getConsumptionAnalytics(timeFrame as any);
      
      res.json({
        success: true,
        data: analytics,
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }
}