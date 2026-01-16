import { 
  pgTable, uuid, varchar, timestamp, text, integer, 
  decimal, boolean, jsonb, pgEnum, date, uniqueIndex, 
  index, primaryKey, foreignKey 
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ==================== ENUMS ====================
export const userRoleEnum = pgEnum('user_role', ['admin', 'doctor', 'nurse', 'pharmacist', 'management', 'lab_tech', 'radiologist']);
export const urgencyLevelEnum = pgEnum('urgency_level', ['RED', 'YELLOW', 'GREEN']);
export const queueStatusEnum = pgEnum('queue_status', ['WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'SKIPPED']);
export const resourceTypeEnum = pgEnum('resource_type', ['BED', 'VENTILATOR', 'MONITOR', 'DEFIBRILLATOR', 'INFUSION_PUMP', 'ECG', 'XRAY']);
export const resourceStatusEnum = pgEnum('resource_status', ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'OUT_OF_SERVICE', 'RESERVED']);
export const labOrderStatusEnum = pgEnum('lab_order_status', ['PENDING', 'COLLECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FAILED']);
export const appointmentStatusEnum = pgEnum('appointment_status', ['SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
export const medicationStatusEnum = pgEnum('medication_status', ['ACTIVE', 'DISCONTINUED', 'OUT_OF_STOCK', 'EXPIRED']);
export const notificationTypeEnum = pgEnum('notification_type', ['SMS', 'EMAIL', 'PUSH', 'IN_APP']);
export const notificationStatusEnum = pgEnum('notification_status', ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'READ']);

// ==================== USERS ====================
export const users = pgTable('users', {
  userId: uuid('user_id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  role: userRoleEnum('role').notNull().default('nurse'),
  department: varchar('department', { length: 100 }),
  specialization: varchar('specialization', { length: 200 }),
  licenseNumber: varchar('license_number', { length: 50 }),
  phoneNumber: varchar('phone_number', { length: 20 }),
  avatarUrl: text('avatar_url'),
  isActive: boolean('is_active').notNull().default(true),
  isAvailable: boolean('is_available').notNull().default(true),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_email_idx').on(table.email),
  index('users_role_idx').on(table.role),
  index('users_department_idx').on(table.department),
  index('users_active_idx').on(table.isActive),
]);

export const usersRelations = relations(users, ({ many }) => ({
  triageSessions: many(triageSessions),
  doctorAssignments: many(doctorAssignments),
  prescriptions: many(prescriptions),
  labOrders: many(labOrders),
  notifications: many(notifications),
  auditLogs: many(auditLogs),
}));

// ==================== PATIENTS ====================
export const patients = pgTable('patients', {
  patientId: uuid('patient_id').primaryKey().defaultRandom(),
  straId: varchar('stra_id', { length: 20 }).notNull().unique(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  dateOfBirth: date('date_of_birth').notNull(),
  gender: varchar('gender', { length: 10 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 15 }).notNull(),
  emergencyContact: varchar('emergency_contact', { length: 15 }),
  emergencyContactName: varchar('emergency_contact_name', { length: 100 }),
  nationalId: varchar('national_id', { length: 50 }).unique(),
  nhifNumber: varchar('nhif_number', { length: 50 }),
  address: text('address'),
  county: varchar('county', { length: 100 }),
  subCounty: varchar('sub_county', { length: 100 }),
  bloodGroup: varchar('blood_group', { length: 5 }),
  allergies: jsonb('allergies').default([]),
  chronicConditions: jsonb('chronic_conditions').default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('patients_stra_id_idx').on(table.straId),
  index('patients_phone_idx').on(table.phoneNumber),
  index('patients_national_id_idx').on(table.nationalId),
  index('patients_name_idx').on(table.firstName, table.lastName),
]);

export const patientsRelations = relations(patients, ({ many }) => ({
  triageSessions: many(triageSessions),
  queueEntries: many(departmentQueues),
  prescriptions: many(prescriptions),
  labOrders: many(labOrders),
  doctorAssignments: many(doctorAssignments),
  appointments: many(appointments),
  vitalsHistory: many(vitalsHistory),
}));

// ==================== DEPARTMENTS ====================
export const departments = pgTable('departments', {
  departmentId: uuid('department_id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  code: varchar('code', { length: 10 }).notNull().unique(),
  description: text('description'),
  location: varchar('location', { length: 200 }),
  phoneExtension: varchar('phone_extension', { length: 10 }),
  currentPatientLoad: integer('current_patient_load').notNull().default(0),
  maxCapacity: integer('max_capacity').notNull().default(50),
  averageTreatmentTime: integer('average_treatment_time').notNull().default(20),
  colorCode: varchar('color_code', { length: 7 }).default('#3B82F6'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('departments_name_idx').on(table.name),
  uniqueIndex('departments_code_idx').on(table.code),
  index('departments_active_idx').on(table.isActive),
]);

export const departmentsRelations = relations(departments, ({ many }) => ({
  queueEntries: many(departmentQueues),
  resources: many(resources),
  staff: many(departmentStaff),
  appointments: many(appointments),
}));

// ==================== DEPARTMENT STAFF (Many-to-Many) ====================
export const departmentStaff = pgTable('department_staff', {
  id: uuid('id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull().references(() => departments.departmentId, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.userId, { onDelete: 'cascade' }),
  isPrimary: boolean('is_primary').notNull().default(false),
  assignedAt: timestamp('assigned_at').notNull().defaultNow(),
  assignedBy: uuid('assigned_by').references(() => users.userId),
}, (table) => [
  uniqueIndex('department_staff_unique_idx').on(table.departmentId, table.userId),
  index('department_staff_dept_idx').on(table.departmentId),
  index('department_staff_user_idx').on(table.userId),
]);

// ==================== TRIAGE SESSIONS ====================
export const triageSessions = pgTable('triage_sessions', {
  sessionId: uuid('session_id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  nurseId: uuid('nurse_id').notNull().references(() => users.userId),
  temperature: decimal('temperature', { precision: 4, scale: 2 }),
  systolicBp: integer('systolic_bp'),
  diastolicBp: integer('diastolic_bp'),
  heartRate: integer('heart_rate'),
  respiratoryRate: integer('respiratory_rate'),
  oxygenSaturation: decimal('oxygen_saturation', { precision: 4, scale: 2 }),
  bloodGlucose: decimal('blood_glucose', { precision: 5, scale: 2 }),
  painScale: integer('pain_scale').notNull().default(0),
  weight: decimal('weight', { precision: 5, scale: 2 }),
  height: decimal('height', { precision: 5, scale: 2 }),
  bmi: decimal('bmi', { precision: 4, scale: 2 }),
  symptoms: jsonb('symptoms').notNull().default({}),
  chiefComplaint: text('chief_complaint'),
  triageScore: integer('triage_score').notNull(),
  urgencyLevel: urgencyLevelEnum('urgency_level').notNull(),
  recommendedDept: varchar('recommended_dept', { length: 50 }).notNull(),
  estimatedWaitMinutes: integer('estimated_wait_minutes').notNull(),
  notes: text('notes'),
  isSynced: boolean('is_synced').notNull().default(false),
  syncedAt: timestamp('synced_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('triage_patient_id_idx').on(table.patientId),
  index('triage_urgency_idx').on(table.urgencyLevel, table.createdAt),
  index('triage_nurse_id_idx').on(table.nurseId),
  index('triage_created_idx').on(table.createdAt),
]);

export const triageSessionsRelations = relations(triageSessions, ({ one }) => ({
  patient: one(patients, {
    fields: [triageSessions.patientId],
    references: [patients.patientId],
  }),
  nurse: one(users, {
    fields: [triageSessions.nurseId],
    references: [users.userId],
  }),
}));

// ==================== VITAL SIGNS HISTORY ====================
export const vitalsHistory = pgTable('vitals_history', {
  vitalId: uuid('vital_id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  recordedBy: uuid('recorded_by').notNull().references(() => users.userId),
  temperature: decimal('temperature', { precision: 4, scale: 2 }),
  systolicBp: integer('systolic_bp'),
  diastolicBp: integer('diastolic_bp'),
  heartRate: integer('heart_rate'),
  respiratoryRate: integer('respiratory_rate'),
  oxygenSaturation: decimal('oxygen_saturation', { precision: 4, scale: 2 }),
  bloodGlucose: decimal('blood_glucose', { precision: 5, scale: 2 }),
  painScale: integer('pain_scale'),
  weight: decimal('weight', { precision: 5, scale: 2 }),
  height: decimal('height', { precision: 5, scale: 2 }),
  bmi: decimal('bmi', { precision: 4, scale: 2 }),
  notes: text('notes'),
  isCritical: boolean('is_critical').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('vitals_patient_id_idx').on(table.patientId),
  index('vitals_created_idx').on(table.createdAt),
  index('vitals_critical_idx').on(table.isCritical),
]);

// ==================== DEPARTMENT QUEUES ====================
export const departmentQueues = pgTable('department_queues', {
  queueId: uuid('queue_id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull().references(() => departments.departmentId, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  triageSessionId: uuid('triage_session_id').references(() => triageSessions.sessionId),
  urgencyLevel: urgencyLevelEnum('urgency_level').notNull(),
  positionInQueue: integer('position_in_queue').notNull(),
  expectedWaitTime: integer('expected_wait_time').notNull(),
  status: queueStatusEnum('status').notNull().default('WAITING'),
  calledAt: timestamp('called_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  assignedDoctorId: uuid('assigned_doctor_id').references(() => users.userId),
  assignedRoom: varchar('assigned_room', { length: 50 }),
  waitNotes: text('wait_notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('queue_dept_status_idx').on(table.departmentId, table.status, table.positionInQueue),
  index('queue_patient_id_idx').on(table.patientId),
  index('queue_urgency_idx').on(table.urgencyLevel),
  index('queue_assigned_doctor_idx').on(table.assignedDoctorId),
  index('queue_created_idx').on(table.createdAt),
]);

export const departmentQueuesRelations = relations(departmentQueues, ({ one }) => ({
  department: one(departments, {
    fields: [departmentQueues.departmentId],
    references: [departments.departmentId],
  }),
  patient: one(patients, {
    fields: [departmentQueues.patientId],
    references: [patients.patientId],
  }),
  triageSession: one(triageSessions, {
    fields: [departmentQueues.triageSessionId],
    references: [triageSessions.sessionId],
  }),
  assignedDoctor: one(users, {
    fields: [departmentQueues.assignedDoctorId],
    references: [users.userId],
  }),
}));

// ==================== APPOINTMENTS ====================
export const appointments = pgTable('appointments', {
  appointmentId: uuid('appointment_id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  doctorId: uuid('doctor_id').references(() => users.userId),
  departmentId: uuid('department_id').references(() => departments.departmentId),
  appointmentDate: date('appointment_date').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  reason: text('reason'),
  status: appointmentStatusEnum('status').notNull().default('SCHEDULED'),
  isWalkIn: boolean('is_walk_in').notNull().default(false),
  checkedInAt: timestamp('checked_in_at'),
  checkedInBy: uuid('checked_in_by').references(() => users.userId),
  notes: text('notes'),
  reminderSent: boolean('reminder_sent').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('appointments_patient_idx').on(table.patientId),
  index('appointments_doctor_idx').on(table.doctorId),
  index('appointments_date_idx').on(table.appointmentDate),
  index('appointments_status_idx').on(table.status),
]);

// ==================== RESOURCES ====================
export const resources = pgTable('resources', {
  resourceId: uuid('resource_id').primaryKey().defaultRandom(),
  resourceType: resourceTypeEnum('resource_type').notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  model: varchar('model', { length: 100 }),
  serialNumber: varchar('serial_number', { length: 50 }).unique(),
  assetTag: varchar('asset_tag', { length: 50 }),
  departmentId: uuid('department_id').references(() => departments.departmentId, { onDelete: 'set null' }),
  location: varchar('location', { length: 200 }),
  status: resourceStatusEnum('status').notNull().default('AVAILABLE'),
  currentPatientId: uuid('current_patient_id').references(() => patients.patientId),
  lastMaintenance: date('last_maintenance'),
  nextMaintenance: date('next_maintenance'),
  maintenanceIntervalDays: integer('maintenance_interval_days'),
  specifications: jsonb('specifications'),
  purchaseDate: date('purchase_date'),
  warrantyExpiry: date('warranty_expiry'),
  purchaseCost: decimal('purchase_cost', { precision: 10, scale: 2 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('resources_dept_type_idx').on(table.departmentId, table.resourceType),
  index('resources_status_idx').on(table.status),
  index('resources_serial_idx').on(table.serialNumber),
  index('resources_asset_idx').on(table.assetTag),
]);

export const resourcesRelations = relations(resources, ({ one }) => ({
  department: one(departments, {
    fields: [resources.departmentId],
    references: [departments.departmentId],
  }),
  currentPatient: one(patients, {
    fields: [resources.currentPatientId],
    references: [patients.patientId],
  }),
}));

// ==================== MEDICATION STOCK ====================
export const medicationStock = pgTable('medication_stock', {
  medicationId: uuid('medication_id').primaryKey().defaultRandom(),
  medicationName: varchar('medication_name', { length: 200 }).notNull(),
  genericName: varchar('generic_name', { length: 200 }).notNull(),
  dosageForm: varchar('dosage_form', { length: 50 }).notNull(),
  strength: varchar('strength', { length: 50 }).notNull(),
  unit: varchar('unit', { length: 20 }).notNull(),
  barcode: varchar('barcode', { length: 100 }),
  currentStock: integer('current_stock').notNull().default(0),
  minimumThreshold: integer('minimum_threshold').notNull().default(10),
  reorderQuantity: integer('reorder_quantity').notNull().default(100),
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }).notNull(),
  sellingPrice: decimal('selling_price', { precision: 10, scale: 2 }),
  lastRestockDate: date('last_restock_date'),
  expiryDate: date('expiry_date'),
  supplierId: uuid('supplier_id'),
  supplierName: varchar('supplier_name', { length: 200 }),
  storageConditions: text('storage_conditions'),
  status: medicationStatusEnum('status').notNull().default('ACTIVE'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('medication_name_idx').on(table.medicationName),
  index('medication_stock_idx').on(table.currentStock),
  index('medication_status_idx').on(table.status),
  index('medication_expiry_idx').on(table.expiryDate),
]);

// ==================== PRESCRIPTIONS ====================
export const prescriptions = pgTable('prescriptions', {
  prescriptionId: uuid('prescription_id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  doctorId: uuid('doctor_id').notNull().references(() => users.userId),
  encounterId: uuid('encounter_id'),
  medications: jsonb('medications').notNull(),
  diagnosis: text('diagnosis'),
  clinicalNotes: text('clinical_notes'),
  instructions: text('instructions'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  refillsAllowed: integer('refills_allowed').notNull().default(0),
  refillsRemaining: integer('refills_remaining').notNull().default(0),
  isDispensed: boolean('is_dispensed').notNull().default(false),
  dispensedAt: timestamp('dispensed_at'),
  dispensedBy: uuid('dispensed_by').references(() => users.userId),
  pharmacyNotes: text('pharmacy_notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('prescriptions_patient_idx').on(table.patientId),
  index('prescriptions_doctor_idx').on(table.doctorId),
  index('prescriptions_dispensed_idx').on(table.isDispensed),
  index('prescriptions_date_idx').on(table.createdAt),
]);

export const prescriptionsRelations = relations(prescriptions, ({ one }) => ({
  patient: one(patients, {
    fields: [prescriptions.patientId],
    references: [patients.patientId],
  }),
  doctor: one(users, {
    fields: [prescriptions.doctorId],
    references: [users.userId],
  }),
}));

// ==================== LAB ORDERS ====================
export const labOrders = pgTable('lab_orders', {
  orderId: uuid('order_id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  doctorId: uuid('doctor_id').notNull().references(() => users.userId),
  tests: jsonb('tests').notNull(),
  priority: urgencyLevelEnum('priority').notNull().default('GREEN'),
  status: labOrderStatusEnum('status').notNull().default('PENDING'),
  orderedAt: timestamp('ordered_at').notNull().defaultNow(),
  collectedAt: timestamp('collected_at'),
  completedAt: timestamp('completed_at'),
  collectedBy: uuid('collected_by').references(() => users.userId),
  completedBy: uuid('completed_by').references(() => users.userId),
  results: jsonb('results'),
  interpretation: text('interpretation'),
  isCritical: boolean('is_critical').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('lab_orders_patient_idx').on(table.patientId),
  index('lab_orders_status_idx').on(table.status),
  index('lab_orders_critical_idx').on(table.isCritical),
  index('lab_orders_priority_idx').on(table.priority),
]);

export const labOrdersRelations = relations(labOrders, ({ one }) => ({
  patient: one(patients, {
    fields: [labOrders.patientId],
    references: [patients.patientId],
  }),
  doctor: one(users, {
    fields: [labOrders.doctorId],
    references: [users.userId],
  }),
}));

// ==================== DIAGNOSTIC IMAGING ====================
export const diagnosticImaging = pgTable('diagnostic_imaging', {
  imagingId: uuid('imaging_id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  doctorId: uuid('doctor_id').notNull().references(() => users.userId),
  modality: varchar('modality', { length: 50 }).notNull(),
  bodyPart: varchar('body_part', { length: 100 }).notNull(),
  clinicalIndication: text('clinical_indication').notNull(),
  priority: urgencyLevelEnum('priority').notNull().default('GREEN'),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  scheduledTime: timestamp('scheduled_time'),
  completedAt: timestamp('completed_at'),
  findings: text('findings'),
  impression: text('impression'),
  radiologistId: uuid('radiologist_id').references(() => users.userId),
  reportUrl: text('report_url'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('imaging_patient_idx').on(table.patientId),
  index('imaging_status_idx').on(table.status),
  index('imaging_modality_idx').on(table.modality),
]);

// ==================== DOCTOR ASSIGNMENTS ====================
export const doctorAssignments = pgTable('doctor_assignments', {
  assignmentId: uuid('assignment_id').primaryKey().defaultRandom(),
  doctorId: uuid('doctor_id').notNull().references(() => users.userId),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  assignedAt: timestamp('assigned_at').notNull().defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('assignments_doctor_patient_idx').on(table.doctorId, table.patientId),
  index('assignments_status_idx').on(table.status),
]);

export const doctorAssignmentsRelations = relations(doctorAssignments, ({ one }) => ({
  doctor: one(users, {
    fields: [doctorAssignments.doctorId],
    references: [users.userId],
  }),
  patient: one(patients, {
    fields: [doctorAssignments.patientId],
    references: [patients.patientId],
  }),
}));

// ==================== NOTIFICATIONS ====================
export const notifications = pgTable('notifications', {
  notificationId: uuid('notification_id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.userId, { onDelete: 'cascade' }),
  patientId: uuid('patient_id').references(() => patients.patientId, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 200 }).notNull(),
  message: text('message').notNull(),
  status: notificationStatusEnum('status').notNull().default('PENDING'),
  priority: urgencyLevelEnum('priority').notNull().default('GREEN'),
  metadata: jsonb('metadata'),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),
  readAt: timestamp('read_at'),
  retryCount: integer('retry_count').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('notifications_user_idx').on(table.userId),
  index('notifications_status_idx').on(table.status),
  index('notifications_type_idx').on(table.type),
  index('notifications_created_idx').on(table.createdAt),
]);

// ==================== AUDIT LOGS ====================
export const auditLogs = pgTable('audit_logs', {
  logId: uuid('log_id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.userId, { onDelete: 'set null' }),
  action: varchar('action', { length: 50 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id'),
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  details: text('details'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('audit_user_idx').on(table.userId),
  index('audit_action_idx').on(table.action),
  index('audit_entity_idx').on(table.entityType, table.entityId),
  index('audit_created_idx').on(table.createdAt),
]);

// ==================== SYSTEM SETTINGS ====================
export const systemSettings = pgTable('system_settings', {
  settingId: uuid('setting_id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: jsonb('value').notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  description: text('description'),
  isEditable: boolean('is_editable').notNull().default(true),
  updatedBy: uuid('updated_by').references(() => users.userId),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('settings_key_idx').on(table.key),
  index('settings_category_idx').on(table.category),
]);

// ==================== TYPES ====================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;

export type TriageSession = typeof triageSessions.$inferSelect;
export type NewTriageSession = typeof triageSessions.$inferInsert;

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;

export type DepartmentQueue = typeof departmentQueues.$inferSelect;
export type NewDepartmentQueue = typeof departmentQueues.$inferInsert;

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;

export type MedicationStock = typeof medicationStock.$inferSelect;
export type NewMedicationStock = typeof medicationStock.$inferInsert;

export type Prescription = typeof prescriptions.$inferSelect;
export type NewPrescription = typeof prescriptions.$inferInsert;

export type LabOrder = typeof labOrders.$inferSelect;
export type NewLabOrder = typeof labOrders.$inferInsert;

export type DoctorAssignment = typeof doctorAssignments.$inferSelect;
export type NewDoctorAssignment = typeof doctorAssignments.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

// Export all schemas
export const schema = {
  users,
  patients,
  departments,
  departmentStaff,
  triageSessions,
  vitalsHistory,
  departmentQueues,
  appointments,
  resources,
  medicationStock,
  prescriptions,
  labOrders,
  diagnosticImaging,
  doctorAssignments,
  notifications,
  auditLogs,
  systemSettings,
};