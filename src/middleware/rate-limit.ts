import rateLimit from 'express-rate-limit';
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from '../config/env.js';

export const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS!,
  max: RATE_LIMIT_MAX!,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    success: false,
    error: 'Too many login attempts, please try again later.',
  },
});