import { Router } from 'express';
import { TriageController } from '../controllers/TriageController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { 
  patientRegistrationSchema, 
  triageSchema, 
  queueUpdateSchema 
} from '../utils/validators';

const router = Router();
const triageController = new TriageController();

// Patient registration
router.post(
  '/patients',
  authenticate,
  authorize('nurse', 'admin'),
  validate(patientRegistrationSchema),
  triageController.registerPatient
);

// Perform triage
router.post(
  '/triage',
  authenticate,
  authorize('nurse'),
  validate(triageSchema),
  triageController.performTriage
);

// Get patient details
router.get(
  '/patients/:patientId',
  authenticate,
  authorize('nurse', 'doctor', 'admin'),
  triageController.getPatientDetails
);

// Get department queue
router.get(
  '/queue/:departmentId',
  authenticate,
  triageController.getQueue
);

// Update queue position
router.patch(
  '/queue/:queueId/position',
  authenticate,
  authorize('nurse', 'admin'),
  validate(queueUpdateSchema),
  triageController.updateQueuePosition
);

// Prioritize critical patients
router.post(
  '/queue/:departmentId/prioritize',
  authenticate,
  authorize('nurse', 'admin'),
  triageController.prioritizeQueue
);

// Get triage statistics
router.get(
  '/statistics',
  authenticate,
  authorize('admin', 'management'),
  triageController.getStatistics
);

export default router;