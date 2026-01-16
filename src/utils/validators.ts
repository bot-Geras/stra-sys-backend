import { z } from 'zod';

export const patientRegistrationSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  gender: z.enum(['Male', 'Female', 'Other']),
  phoneNumber: z.string().min(10, 'Valid phone number required'),
  emergencyContact: z.string().optional(),
  nationalId: z.string().optional(),
  address: z.string().optional(),
  bloodGroup: z.string().optional(),
  allergies: z.array(z.string()).optional(),
  chronicConditions: z.array(z.string()).optional(),
});

export const triageSchema = z.object({
  patientId: z.string().uuid('Valid patient ID required'),
  nurseId: z.string().uuid('Valid nurse ID required'),
  vitals: z.object({
    temperature: z.number().min(30).max(45).optional(),
    systolicBp: z.number().min(50).max(250).optional(),
    diastolicBp: z.number().min(30).max(150).optional(),
    heartRate: z.number().min(30).max(250).optional(),
    respiratoryRate: z.number().min(5).max(60).optional(),
    oxygenSaturation: z.number().min(70).max(100).optional(),
    bloodGlucose: z.number().min(1).max(50).optional(),
    painScale: z.number().min(0).max(10),
    weight: z.number().min(1).max(300).optional(),
    height: z.number().min(30).max(250).optional(),
  }),
  symptoms: z.record(z.string(), z.any()),
  chiefComplaint: z.string().optional(),
});

export const queueUpdateSchema = z.object({
  position: z.number().int().min(1, 'Position must be at least 1'),
});

export const resourceAllocationSchema = z.object({
  patientId: z.string().uuid('Valid patient ID required'),
});

export const maintenanceSchema = z.object({
  maintenanceDate: z.string().datetime(),
  estimatedCompletion: z.string().datetime(),
  notes: z.string().optional(),
});

export const labOrderSchema = z.object({
  patientId: z.string().uuid(),
  tests: z.array(z.object({
    testCode: z.string(),
    testName: z.string(),
    specimenType: z.string(),
    urgency: z.enum(['ROUTINE', 'URGENT', 'STAT']),
    instructions: z.string().optional(),
  })),
});

export const prescriptionSchema = z.object({
  patientId: z.string().uuid(),
  medications: z.array(z.object({
    medicationId: z.string().uuid(),
    name: z.string(),
    dosage: z.string(),
    frequency: z.string(),
    duration: z.string(),
    instructions: z.string().optional(),
  })),
  diagnosis: z.string(),
  instructions: z.string().optional(),
});

export const vitalSignsSchema = z.object({
  temperature: z.number().min(30).max(45).optional(),
  systolicBp: z.number().min(50).max(250).optional(),
  diastolicBp: z.number().min(30).max(150).optional(),
  heartRate: z.number().min(30).max(250).optional(),
  respiratoryRate: z.number().min(5).max(60).optional(),
  oxygenSaturation: z.number().min(70).max(100).optional(),
  bloodGlucose: z.number().min(1).max(50).optional(),
  painScale: z.number().min(0).max(10).optional(),
  weight: z.number().min(1).max(300).optional(),
  height: z.number().min(30).max(250).optional(),
  notes: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});