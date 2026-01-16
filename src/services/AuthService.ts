import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/error';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { RedisService } from './RedisService';

export class AuthService {
  private redisService: RedisService;

  constructor() {
    this.redisService = new RedisService();
  }

  async register(userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: string;
    department?: string;
    phoneNumber?: string;
    specialization?: string;
    licenseNumber?: string;
  }): Promise<{ user: any; token: string; refreshToken: string }> {
    try {
      // Check if user exists
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, userData.email))
        .limit(1);

      if (existingUser.length > 0) {
        throw new AppError('User already exists', 400);
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      // Create user
      const [user] = await db
        .insert(users)
        .values({
          ...userData,
          password: hashedPassword,
          isActive: true,
          isAvailable: true,
        })
        .returning();

      // Generate tokens
      const token = this.generateToken(user);
      const refreshToken = this.generateRefreshToken(user);

      // Remove password from response
      const { password, ...userWithoutPassword } = user;

      logger.info(`User registered: ${user.email}`, { userId: user.userId, role: user.role });

      return {
        user: userWithoutPassword,
        token,
        refreshToken,
      };
    } catch (error) {
      logger.error('Registration failed:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Registration failed', 500);
    }
  }

  async login(email: string, password: string): Promise<{ user: any; token: string; refreshToken: string }> {
    try {
      // Find user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        throw new AppError('Invalid credentials', 401);
      }

      // Check if user is active
      if (!user.isActive) {
        throw new AppError('Account is deactivated', 403);
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        throw new AppError('Invalid credentials', 401);
      }

      // Update last login
      await db
        .update(users)
        .set({
          lastLoginAt: new Date(),
        })
        .where(eq(users.userId, user.userId));

      // Generate tokens
      const token = this.generateToken(user);
      const refreshToken = this.generateRefreshToken(user);

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      // Store refresh token in Redis
      await this.redisService.set(
        `refresh_token:${user.userId}`,
        refreshToken,
        7 * 24 * 60 * 60 // 7 days
      );

      logger.info(`User logged in: ${user.email}`, { userId: user.userId, role: user.role });

      return {
        user: userWithoutPassword,
        token,
        refreshToken,
      };
    } catch (error) {
      logger.error('Login failed:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Login failed', 500);
    }
  }

  async refreshToken(refreshToken: string): Promise<{ token: string; refreshToken: string }> {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as any;
      
      // Check if token exists in Redis
      const storedToken = await this.redisService.get(`refresh_token:${decoded.userId}`);
      if (!storedToken || storedToken !== refreshToken) {
        throw new AppError('Invalid refresh token', 401);
      }

      // Get user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.userId, decoded.userId))
        .limit(1);

      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Generate new tokens
      const newToken = this.generateToken(user);
      const newRefreshToken = this.generateRefreshToken(user);

      // Update refresh token in Redis
      await this.redisService.set(
        `refresh_token:${user.userId}`,
        newRefreshToken,
        7 * 24 * 60 * 60
      );

      return {
        token: newToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      logger.error('Token refresh failed:', error);
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError('Invalid token', 401);
      }
      if (error instanceof AppError) throw error;
      throw new AppError('Token refresh failed', 500);
    }
  }

  async logout(userId: string): Promise<void> {
    try {
      // Remove refresh token from Redis
      await this.redisService.del(`refresh_token:${userId}`);
      
      logger.info(`User logged out: ${userId}`);
    } catch (error) {
      logger.error('Logout failed:', error);
      throw new AppError('Logout failed', 500);
    }
  }

  async changePassword(userId: string, data: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    try {
      // Get user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.userId, userId))
        .limit(1);

      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Verify current password
      const isPasswordValid = await bcrypt.compare(data.currentPassword, user.password);
      if (!isPasswordValid) {
        throw new AppError('Current password is incorrect', 400);
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(data.newPassword, 10);

      // Update password
      await db
        .update(users)
        .set({
          password: hashedPassword,
          updatedAt: new Date(),
        })
        .where(eq(users.userId, userId));

      // Invalidate all refresh tokens
      await this.redisService.del(`refresh_token:${userId}`);

      logger.info(`Password changed for user: ${userId}`);
    } catch (error) {
      logger.error('Password change failed:', error);
      if (error instanceof AppError) throw error;
      throw new AppError('Password change failed', 500);
    }
  }

  async forgotPassword(email: string): Promise<{ resetToken: string }> {
    try {
      // Find user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        // Don't reveal that user doesn't exist
        return { resetToken: 'dummy_token' };
      }

      // Generate reset token (valid for 1 hour)
      const resetToken = jwt.sign(
        { userId: user.userId, email: user.email },
        env.JWT_SECRET + user.password, // Password in secret to invalidate when password changes
        { expiresIn: '1h' }
      );

      // Store token in Redis
      await this.redisService.set(
        `reset_token:${user.userId}`,
        resetToken,
        3600 // 1 hour
      );

      // In production, send email with reset link
      logger.info(`Password reset requested for: ${email}`, { userId: user.userId });

      return { resetToken: 'dummy_token' }; // In production, return actual token
    } catch (error) {
      logger.error('Forgot password failed:', error);
      throw new AppError('Forgot password failed', 500);
    }
  }

  async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    try {
      // Verify token
      const decoded = jwt.verify(resetToken, env.JWT_SECRET) as any;
      
      // Check if token exists in Redis
      const storedToken = await this.redisService.get(`reset_token:${decoded.userId}`);
      if (!storedToken || storedToken !== resetToken) {
        throw new AppError('Invalid or expired reset token', 400);
      }

      // Get user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.userId, decoded.userId))
        .limit(1);

      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      await db
        .update(users)
        .set({
          password: hashedPassword,
          updatedAt: new Date(),
        })
        .where(eq(users.userId, decoded.userId));

      // Remove reset token
      await this.redisService.del(`reset_token:${decoded.userId}`);

      // Invalidate all refresh tokens
      await this.redisService.del(`refresh_token:${decoded.userId}`);

      logger.info(`Password reset for user: ${decoded.userId}`);
    } catch (error) {
      logger.error('Password reset failed:', error);
      if (error instanceof jwt.JsonWebTokenError) {
        throw new AppError('Invalid or expired token', 400);
      }
      if (error instanceof AppError) throw error;
      throw new AppError('Password reset failed', 500);
    }
  }

  async updateProfile(userId: string, data: {
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    department?: string;
    specialization?: string;
    avatarUrl?: string;
  }): Promise<any> {
    try {
      const [updatedUser] = await db
        .update(users)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(users.userId, userId))
        .returning();

      const { password, ...userWithoutPassword } = updatedUser;

      logger.info(`Profile updated for user: ${userId}`);

      return userWithoutPassword;
    } catch (error) {
      logger.error('Profile update failed:', error);
      throw new AppError('Profile update failed', 500);
    }
  }

  private generateToken(user: any): string {
    return jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        role: user.role,
        department: user.department,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRY }
    );
  }

  private generateRefreshToken(user: any): string {
    return jwt.sign(
      {
        userId: user.userId,
        email: user.email,
      },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRY || '7d' }
    );
  }
}