import { Router } from 'express';
import { ResourceController } from '../controllers/ResourceController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { resourceAllocationSchema, maintenanceSchema } from '../utils/validators';

const router = Router();
const resourceController = new ResourceController();

// Resource dashboard
router.get(
  '/dashboard',
  authenticate,
  authorize('admin', 'management', 'doctor'),
  resourceController.getDashboard
);

// Allocate resource
router.post(
  '/:resourceId/allocate',
  authenticate,
  authorize('doctor', 'nurse', 'admin'),
  validate(resourceAllocationSchema),
  resourceController.allocateResource
);

// Release resource
router.post(
  '/:resourceId/release',
  authenticate,
  authorize('doctor', 'nurse', 'admin'),
  resourceController.releaseResource
);

// Set maintenance
router.post(
  '/:resourceId/maintenance',
  authenticate,
  authorize('admin', 'management'),
  validate(maintenanceSchema),
  resourceController.setMaintenance
);

// Predictive analytics
router.get(
  '/predictive-load',
  authenticate,
  authorize('admin', 'management'),
  resourceController.getPredictiveLoad
);

// Resource availability
router.get(
  '/availability',
  authenticate,
  resourceController.getResourceAvailability
);

export default router;