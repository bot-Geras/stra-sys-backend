import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { authenticate, authorize } from '../middleware/auth';

const router = Router();
const analyticsController = new AnalyticsController();

// Patient volume reports
router.get(
  '/patient-volume',
  authenticate,
  authorize('admin', 'management', 'doctor'),
  analyticsController.getPatientVolume
);

// Wait time analytics
router.get(
  '/wait-times',
  authenticate,
  authorize('admin', 'management', 'doctor'),
  analyticsController.getWaitTimes
);

// Outbreak detection
router.get(
  '/outbreak-detection',
  authenticate,
  authorize('admin', 'management', 'doctor'),
  analyticsController.detectOutbreaks
);

// Staff productivity
router.get(
  '/staff-productivity',
  authenticate,
  authorize('admin', 'management'),
  analyticsController.getStaffProductivity
);

// Resource utilization
router.get(
  '/resource-utilization',
  authenticate,
  authorize('admin', 'management', 'doctor'),
  analyticsController.getResourceUtilization
);

// Medication analytics
router.get(
  '/medication-analytics',
  authenticate,
  authorize('admin', 'management', 'pharmacist'),
  analyticsController.getMedicationAnalytics
);

// KPI Dashboard
router.get(
  '/kpi-dashboard',
  authenticate,
  authorize('admin', 'management'),
  analyticsController.getKPIDashboard
);

// Financial metrics
router.get(
  '/financial-metrics',
  authenticate,
  authorize('admin', 'management'),
  analyticsController.getFinancialMetrics
);

// Export reports
router.post(
  '/export',
  authenticate,
  authorize('admin', 'management'),
  analyticsController.exportReport
);

export default router;