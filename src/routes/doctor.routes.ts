import { Router } from 'express';
import { DoctorController } from '../controllers/DoctorController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { 
  labOrderSchema, 
  prescriptionSchema,
  vitalSignsSchema 
} from '../utils/validators';

const router = Router();
const doctorController = new DoctorController();

// Doctor queue
router.get(
  '/queue',
  authenticate,
  authorize('doctor'),
  doctorController.getDoctorQueue
);

// Patient details
router.get(
  '/patients/:patientId',
  authenticate,
  authorize('doctor', 'nurse'),
  doctorController.getPatientDetails
);

// Lab orders
router.post(
  '/lab-orders',
  authenticate,
  authorize('doctor'),
  validate(labOrderSchema),
  doctorController.orderLabTests
);

// Diagnostic imaging
router.post(
  '/imaging',
  authenticate,
  authorize('doctor'),
  doctorController.orderDiagnosticImaging
);

// Prescriptions
router.post(
  '/prescriptions',
  authenticate,
  authorize('doctor'),
  validate(prescriptionSchema),
  doctorController.createPrescription
);

// Patient disposition
router.put(
  '/patients/:patientId/disposition',
  authenticate,
  authorize('doctor'),
  doctorController.updatePatientDisposition
);

// Record vital signs
router.post(
  '/patients/:patientId/vitals',
  authenticate,
  authorize('doctor', 'nurse'),
  validate(vitalSignsSchema),
  doctorController.recordVitalSigns
);

// Doctor statistics
router.get(
  '/statistics',
  authenticate,
  authorize('doctor', 'admin'),
  doctorController.getDoctorStatistics
);

// Lab results
router.get(
  '/patients/:patientId/lab-results',
  authenticate,
  authorize('doctor', 'nurse'),
  doctorController.getPatientLabResults
);

export default router;