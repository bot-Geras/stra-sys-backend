import { Request, Response } from 'express';
import { AnalyticsService } from '../services/AnalyticsService';
import { authenticate, authorize } from '../middleware/auth';

const analyticsService = new AnalyticsService();

export class AnalyticsController {
  async getPatientVolume(req: Request, res: Response) {
    try {
      const { timeFrame = 'today', departmentId } = req.query;
      
      const report = await analyticsService.getPatientVolumeReport(timeFrame as any);
      
      res.json({
        success: true,
        data: report,
        message: 'Patient volume report generated successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getWaitTimes(req: Request, res: Response) {
    try {
      const { departmentId } = req.query;
      
      const analytics = await analyticsService.getWaitTimeAnalytics(departmentId as string);
      
      res.json({
        success: true,
        data: analytics,
        message: 'Wait time analytics retrieved successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async detectOutbreaks(req: Request, res: Response) {
    try {
      const outbreaks = await analyticsService.detectOutbreaks();
      
      res.json({
        success: true,
        data: outbreaks,
        message: outbreaks.length > 0 ? 
          `${outbreaks.length} potential outbreak(s) detected` :
          'No outbreaks detected',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getStaffProductivity(req: Request, res: Response) {
    try {
      const { timeFrame = 'week' } = req.query;
      
      const productivity = await analyticsService.getStaffProductivity(timeFrame as any);
      
      res.json({
        success: true,
        data: productivity,
        message: 'Staff productivity report generated',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getResourceUtilization(req: Request, res: Response) {
    try {
      const utilization = await analyticsService.getResourceUtilization();
      
      res.json({
        success: true,
        data: utilization,
        message: 'Resource utilization report generated',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getMedicationAnalytics(req: Request, res: Response) {
    try {
      const analytics = await analyticsService.getMedicationAnalytics();
      
      res.json({
        success: true,
        data: analytics,
        message: 'Medication analytics retrieved successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getKPIDashboard(req: Request, res: Response) {
    try {
      const dashboard = await analyticsService.getKPIDashboard();
      
      res.json({
        success: true,
        data: dashboard,
        message: 'KPI dashboard generated successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async getFinancialMetrics(req: Request, res: Response) {
    try {
      const metrics = await analyticsService.getFinancialMetrics();
      
      res.json({
        success: true,
        data: metrics,
        message: 'Financial metrics retrieved',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async exportReport(req: Request, res: Response) {
    try {
      const { reportType, format = 'json', timeFrame = 'week' } = req.body;
      
      let reportData;
      switch (reportType) {
        case 'patient_volume':
          reportData = await analyticsService.getPatientVolumeReport(timeFrame);
          break;
        case 'wait_times':
          reportData = await analyticsService.getWaitTimeAnalytics();
          break;
        case 'staff_productivity':
          reportData = await analyticsService.getStaffProductivity(timeFrame);
          break;
        case 'kpi_dashboard':
          reportData = await analyticsService.getKPIDashboard();
          break;
        default:
          throw new Error('Invalid report type');
      }
      
      // In production, generate actual files (CSV/PDF)
      const exportResult = {
        exportedAt: new Date(),
        reportType,
        format,
        data: reportData,
        downloadUrl: format === 'csv' ? 
          `/api/v1/analytics/exports/${reportType}_${Date.now()}.csv` :
          `/api/v1/analytics/exports/${reportType}_${Date.now()}.json`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      };
      
      res.json({
        success: true,
        data: exportResult,
        message: 'Report export initiated successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }
}