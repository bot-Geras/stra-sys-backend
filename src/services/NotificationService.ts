import axios from 'axios';
import sgMail from '@sendgrid/mail';
import { db } from '../db';
import { notifications, patients, users } from '../db/schema';
import { and, count, eq, sql } from 'drizzle-orm';
import { AppError } from '../middleware/error';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { RedisService } from './RedisService';

export class NotificationService {
  private redisService: RedisService;
  private africasTalkingConfigured: boolean;
  private sendGridConfigured: boolean;

  constructor() {
    this.redisService = new RedisService();
    this.africasTalkingConfigured = !!env.AFRICASTALKING_API_KEY && !!env.AFRICASTALKING_USERNAME;
    this.sendGridConfigured = !!env.SENDGRID_API_KEY;

    if (this.sendGridConfigured) {
      sgMail.setApiKey(env.SENDGRID_API_KEY!);
    }
  }

  async sendCriticalAlert(data: {
    patientId: string;
    straId: string;
    patientName: string;
    department: string;
    mewsScore: number;
    vitalSigns: any;
  }): Promise<void> {
    try {
      const message = `🚨 CRITICAL ALERT: Patient ${data.straId} (${data.patientName}) has MEWS score ${data.mewsScore} in ${data.department}. Requires immediate attention.`;

      // Get all doctors and nurses
      const staff = await db
        .select()
        .from(users)
        .where(eq(users.role, 'doctor').or(eq(users.role, 'nurse')));

      // Send SMS to on-call staff
      const onCallStaff = staff.filter(s => s.isAvailable);
      for (const person of onCallStaff) {
        if (person.phoneNumber) {
          await this.sendSMS(person.phoneNumber, message);
        }
      }

      // Send email to department heads
      const departmentHeads = staff.filter(s => 
        s.department === data.department && 
        ['doctor', 'management'].includes(s.role)
      );
      
      for (const head of departmentHeads) {
        if (head.email) {
          await this.sendEmail(head.email, 'Critical Patient Alert', message);
        }
      }

      // Log notification
      await this.logNotification({
        type: 'SMS',
        title: 'Critical Patient Alert',
        message,
        priority: 'RED',
        metadata: data,
      });

      logger.info(`Critical alert sent for patient ${data.straId}`, data);
    } catch (error) {
      logger.error('Failed to send critical alert:', error);
      // Don't throw error - notification failure shouldn't break main flow
    }
  }

  async sendSMS(phoneNumber: string, message: string): Promise<boolean> {
    try {
      if (!this.africasTalkingConfigured) {
        logger.warn('Africa\'s Talking not configured, SMS not sent');
        return false;
      }

      // Africa's Talking API
      const response = await axios.post(
        'https://api.africastalking.com/version1/messaging',
        {
          username: env.AFRICASTALKING_USERNAME,
          to: phoneNumber,
          message: message,
          from: 'STRA', // Short code or alphanumeric
        },
        {
          headers: {
            'apiKey': env.AFRICASTALKING_API_KEY,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
        }
      );

      logger.info(`SMS sent to ${phoneNumber}:`, response.data);
      return true;
    } catch (error) {
      logger.error('Failed to send SMS:', error);
      return false;
    }
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    try {
      if (!this.sendGridConfigured) {
        logger.warn('SendGrid not configured, email not sent');
        return false;
      }

      const msg = {
        to,
        from: env.EMAIL_FROM || 'noreply@stra-system.com',
        subject,
        html,
      };

      await sgMail.send(msg);
      logger.info(`Email sent to ${to}: ${subject}`);
      return true;
    } catch (error) {
      logger.error('Failed to send email:', error);
      return false;
    }
  }

  async sendDepartmentOverloadAlert(departmentId: string, currentLoad: number, maxCapacity: number): Promise<void> {
    try {
      const utilization = (currentLoad / maxCapacity) * 100;
      const message = `⚠️ Department overload: ${utilization.toFixed(1)}% capacity reached. Current: ${currentLoad}/${maxCapacity} patients.`;

      // Get department staff
      const departmentStaff = await db
        .select()
        .from(users)
        .where(eq(users.department, departmentId));

      // Get management
      const management = await db
        .select()
        .from(users)
        .where(eq(users.role, 'management'));

      const recipients = [...departmentStaff, ...management];

      for (const person of recipients) {
        if (person.phoneNumber && utilization > 90) {
          await this.sendSMS(person.phoneNumber, message);
        }
        if (person.email && utilization > 80) {
          await this.sendEmail(person.email, 'Department Overload Alert', message);
        }
      }

      await this.logNotification({
        type: 'EMAIL',
        title: 'Department Overload',
        message,
        priority: 'YELLOW',
        metadata: { departmentId, currentLoad, maxCapacity, utilization },
      });

      logger.info(`Department overload alert sent for ${departmentId}`);
    } catch (error) {
      logger.error('Failed to send department overload alert:', error);
    }
  }

  async sendLowStockAlert(data: {
    medicationId: string;
    medicationName: string;
    currentStock: number;
    minimumThreshold: number;
  }): Promise<void> {
    try {
      const message = `📦 Low stock alert: ${data.medicationName} has ${data.currentStock} units left (minimum: ${data.minimumThreshold}).`;

      // Get pharmacists and inventory managers
      const recipients = await db
        .select()
        .from(users)
        .where(eq(users.role, 'pharmacist').or(eq(users.role, 'management')));

      for (const person of recipients) {
        if (person.phoneNumber && data.currentStock === 0) {
          await this.sendSMS(person.phoneNumber, `URGENT: ${message}`);
        }
        if (person.email) {
          await this.sendEmail(person.email, 'Medication Low Stock Alert', message);
        }
      }

      await this.logNotification({
        type: 'EMAIL',
        title: 'Low Stock Alert',
        message,
        priority: data.currentStock === 0 ? 'RED' : 'YELLOW',
        metadata: data,
      });

      logger.info(`Low stock alert sent for ${data.medicationName}`);
    } catch (error) {
      logger.error('Failed to send low stock alert:', error);
    }
  }

  async sendShiftChangeSummary(staffId: string, shiftData: any): Promise<void> {
    try {
      const message = `👥 Shift Summary:\nPatients seen: ${shiftData.patientsSeen}\nCritical cases: ${shiftData.criticalCases}\nPending: ${shiftData.pendingCases}`;

      // Get incoming shift staff
      const incomingStaff = await db
        .select()
        .from(users)
        .where(eq(users.department, shiftData.department));

      for (const person of incomingStaff) {
        if (person.phoneNumber) {
          await this.sendSMS(person.phoneNumber, message);
        }
      }

      await this.logNotification({
        type: 'SMS',
        title: 'Shift Change Summary',
        message,
        priority: 'GREEN',
        metadata: shiftData,
      });

      logger.info(`Shift summary sent for staff ${staffId}`);
    } catch (error) {
      logger.error('Failed to send shift summary:', error);
    }
  }

  async sendPatientNotification(patientId: string, type: 'queue' | 'appointment' | 'results', data: any): Promise<void> {
    try {
      const [patient] = await db
        .select()
        .from(patients)
        .where(eq(patients.patientId, patientId));

      if (!patient?.phoneNumber) return;

      let message = '';
      let title = '';

      switch (type) {
        case 'queue':
          message = `👨‍⚕️ Your queue position: ${data.position}. Estimated wait: ${data.waitTime} minutes.`;
          title = 'Queue Update';
          break;
        case 'appointment':
          message = `📅 Appointment reminder: ${data.date} at ${data.time} with ${data.doctor}.`;
          title = 'Appointment Reminder';
          break;
        case 'results':
          message = `📊 Your test results are ready. Please visit the hospital to collect them.`;
          title = 'Test Results Ready';
          break;
      }

      await this.sendSMS(patient.phoneNumber, message);

      await this.logNotification({
        type: 'SMS',
        title,
        message,
        patientId,
        priority: 'GREEN',
        metadata: data,
      });

      logger.info(`Patient notification sent to ${patient.straId}`);
    } catch (error) {
      logger.error('Failed to send patient notification:', error);
    }
  }

  async sendBulkNotifications(recipients: string[], message: string, type: 'SMS' | 'EMAIL'): Promise<any> {
    try {
      const results = [];
      
      for (const recipient of recipients) {
        let success = false;
        
        if (type === 'SMS') {
          success = await this.sendSMS(recipient, message);
        } else {
          success = await this.sendEmail(recipient, 'STRA System Notification', message);
        }
        
        results.push({ recipient, success });
      }

      await this.logNotification({
        type,
        title: 'Bulk Notification',
        message,
        priority: 'GREEN',
        metadata: { recipients: recipients.length, results },
      });

      return results;
    } catch (error) {
      logger.error('Failed to send bulk notifications:', error);
      throw new AppError('Failed to send bulk notifications', 500);
    }
  }

  async getNotificationHistory(filters?: {
    type?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }): Promise<any> {
    try {
      let query = db
        .select()
        .from(notifications)
        .orderBy(notifications.createdAt);

      if (filters?.type) {
        query = query.where(eq(notifications.type, filters.type));
      }

      if (filters?.status) {
        query = query.where(eq(notifications.status, filters.status));
      }

      if (filters?.startDate && filters?.endDate) {
        query = query.where(
          sql`${notifications.createdAt} BETWEEN ${filters.startDate} AND ${filters.endDate}`
        );
      }

      const page = filters?.page || 1;
      const limit = filters?.limit || 50;
      const offset = (page - 1) * limit;

      const [total] = await db.select({ count: count() }).from(notifications);
      const items = await query.limit(limit).offset(offset);

      return {
        items,
        pagination: {
          total: Number(total.count),
          page,
          limit,
          pages: Math.ceil(Number(total.count) / limit),
        },
      };
    } catch (error) {
      logger.error('Failed to get notification history:', error);
      throw new AppError('Failed to get notification history', 500);
    }
  }

  private async logNotification(data: {
    type: string;
    title: string;
    message: string;
    userId?: string;
    patientId?: string;
    priority: string;
    metadata?: any;
  }): Promise<void> {
    try {
      await db.insert(notifications).values({
        type: data.type,
        title: data.title,
        message: data.message,
        userId: data.userId,
        patientId: data.patientId,
        priority: data.priority,
        metadata: data.metadata,
        status: 'SENT',
        sentAt: new Date(),
      });
    } catch (error) {
      logger.error('Failed to log notification:', error);
    }
  }

  async retryFailedNotifications(): Promise<void> {
    try {
      const failedNotifications = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.status, 'FAILED'),
            sql`${notifications.retryCount} < 3`,
            sql`${notifications.createdAt} > NOW() - INTERVAL '24 hours'`
          )
        );

      for (const notification of failedNotifications) {
        try {
          // Implement retry logic based on notification type
          if (notification.type === 'SMS' && notification.metadata?.phoneNumber) {
            await this.sendSMS(notification.metadata.phoneNumber, notification.message);
          }
          
          await db
            .update(notifications)
            .set({
              status: 'SENT',
              sentAt: new Date(),
              retryCount: notification.retryCount + 1,
            })
            .where(eq(notifications.notificationId, notification.notificationId));
        } catch (error) {
          await db
            .update(notifications)
            .set({
              retryCount: notification.retryCount + 1,
              errorMessage: (error as Error).message,
            })
            .where(eq(notifications.notificationId, notification.notificationId));
        }
      }

      logger.info(`Retried ${failedNotifications.length} failed notifications`);
    } catch (error) {
      logger.error('Failed to retry notifications:', error);
    }
  }
}