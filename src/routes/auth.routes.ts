import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { loginSchema } from '../utils/validators';
import { authLimiter } from '../middleware/rate-limit';

const router = Router();
const authController = new AuthController();

// Public routes
router.post(
  '/register',
  validate(loginSchema),
  authController.register
);

router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  authController.login
);

router.post(
  '/refresh-token',
  authController.refreshToken
);

router.post(
  '/forgot-password',
  authController.forgotPassword
);

router.post(
  '/reset-password',
  authController.resetPassword
);

// Protected routes
router.post(
  '/logout',
  authenticate,
  authController.logout
);

router.get(
  '/profile',
  authenticate,
  authController.getProfile
);

router.put(
  '/profile',
  authenticate,
  authController.updateProfile
);

router.post(
  '/change-password',
  authenticate,
  authController.changePassword
);

// Admin only
router.get(
  '/users',
  authenticate,
  authorize('admin'),
  (req, res) => {
    // User list endpoint
    res.json({ message: 'User list endpoint' });
  }
);

export default router;