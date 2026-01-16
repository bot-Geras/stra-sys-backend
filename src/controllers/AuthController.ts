import { Request, Response } from 'express';
import { AuthService } from '../services/AuthService';
import { validate } from '../middleware/validation';
import { loginSchema } from '../utils/validators';
import { z } from 'zod';

const authService = new AuthService();

const registerSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z.enum(['admin', 'doctor', 'nurse', 'pharmacist', 'management', 'lab_tech', 'radiologist']),
  department: z.string().optional(),
  phoneNumber: z.string().optional(),
  specialization: z.string().optional(),
  licenseNumber: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

const resetPasswordSchema = z.object({
  resetToken: z.string().min(1, 'Reset token is required'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters'),
});

const profileUpdateSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phoneNumber: z.string().optional(),
  department: z.string().optional(),
  specialization: z.string().optional(),
  avatarUrl: z.string().optional(),
});

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const userData = registerSchema.parse(req.body);
      const result = await authService.register(userData);
      
      res.status(201).json({
        success: true,
        data: result,
        message: 'User registered successfully',
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

  async login(req: Request, res: Response) {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const result = await authService.login(email, password);
      
      res.json({
        success: true,
        data: result,
        message: 'Login successful',
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

  async refreshToken(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token is required',
        });
      }
      
      const result = await authService.refreshToken(refreshToken);
      
      res.json({
        success: true,
        data: result,
        message: 'Token refreshed successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async logout(req: Request, res: Response) {
    try {
      // @ts-ignore
      const userId = req.user.userId;
      await authService.logout(userId);
      
      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async changePassword(req: Request, res: Response) {
    try {
      // @ts-ignore
      const userId = req.user.userId;
      const data = changePasswordSchema.parse(req.body);
      
      await authService.changePassword(userId, data);
      
      res.json({
        success: true,
        message: 'Password changed successfully',
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

  async forgotPassword(req: Request, res: Response) {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email is required',
        });
      }
      
      const result = await authService.forgotPassword(email);
      
      res.json({
        success: true,
        data: result,
        message: 'If an account exists, a reset link has been sent',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async resetPassword(req: Request, res: Response) {
    try {
      const data = resetPasswordSchema.parse(req.body);
      
      await authService.resetPassword(data.resetToken, data.newPassword);
      
      res.json({
        success: true,
        message: 'Password reset successfully',
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

  async getProfile(req: Request, res: Response) {
    try {
      // @ts-ignore
      const userId = req.user.userId;
      
      // User info is already in req.user from auth middleware
      const user = req.user;
      
      res.json({
        success: true,
        data: user,
        message: 'Profile retrieved successfully',
      });
    } catch (error: any) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
      });
    }
  }

  async updateProfile(req: Request, res: Response) {
    try {
      // @ts-ignore
      const userId = req.user.userId;
      const data = profileUpdateSchema.parse(req.body);
      
      const updatedUser = await authService.updateProfile(userId, data);
      
      res.json({
        success: true,
        data: updatedUser,
        message: 'Profile updated successfully',
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
}