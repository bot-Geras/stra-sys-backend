import { Application } from 'express';
import triageRoutes from './triage.routes';
import doctorRoutes from './doctor.routes';
import analyticsRoutes from './analytics.routes';
import authRoutes from './auth.routes';
import inventoryRoutes from './inventory.routes';
import resourceRoutes from './resource.routes';
// import swaggerUi from 'swagger-ui-express';
// import swaggerDocument from '../docs/swagger.json';

export const setupRoutes = (app: Application) => {
  // API Documentation
  // app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  
  // API Routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/triage', triageRoutes);
  app.use('/api/v1/doctor', doctorRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/v1/inventory', inventoryRoutes);
  app.use('/api/v1/resources', resourceRoutes);
};