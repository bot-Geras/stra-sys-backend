import { Router } from 'express';
import { InventoryController } from '../controllers/InventoryController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { stockUpdateSchema } from '../utils/validators';

const router = Router();
const inventoryController = new InventoryController();

// Get medication stock
router.get(
  '/medications',
  authenticate,
  authorize('pharmacist', 'admin', 'management'),
  inventoryController.getMedicationStock
);

// Update stock level
router.put(
  '/medications/:medicationId/stock',
  authenticate,
  authorize('pharmacist', 'admin'),
  validate(stockUpdateSchema),
  inventoryController.updateStockLevel
);

// Get low stock alerts
router.get(
  '/alerts/low-stock',
  authenticate,
  authorize('pharmacist', 'admin', 'management'),
  inventoryController.getLowStockAlerts
);

// Get consumption analytics
router.get(
  '/analytics/consumption',
  authenticate,
  authorize('admin', 'management'),
  inventoryController.getConsumptionAnalytics
);

export default router;