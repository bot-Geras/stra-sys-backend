import { table } from "console";
import { relations } from "drizzle-orm";
import { boolean, date, decimal, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => sql`now()`),
};

export const userRoleEnum = pgEnum('user_role', ['admin', 'doctor', 'nurse', 'pharmacist', 'management']);
export const urgencyLevelEnum = pgEnum('urgency_level', ['RED', 'YELLOW', 'GREEN']);
export const queueStatusEnum = pgEnum('queue_status', ['WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const resourceTypeEnum = pgEnum('resource_type', ['BED', 'VENTILATOR', 'MONITOR', 'DEFIBRILLATOR', 'INFUSION_PUMP']);
export const resourceStatusEnum = pgEnum('resource_status', ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'OUT_OF_SERVICE']);
export const labOrderStatusEnum = pgEnum('lab_order_status', ['PENDING', 'COLLECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);



export const users = pgTable("users", {
    userId: uuid("user_id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    firstname: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar('last_name', { length: 100 }).notNull(),
    role: userRoleEnum("role").notNull().default('nurse'),
    department: varchar('department', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
  isAvailable: boolean('is_available').notNull().default(true),
  phoneNumber: varchar('phone_number', { length: 20 }),
  ...timestamps,
}, (table) => {
  return {
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
    roleIdx: index('users_role_idx').on(table.role),
    departmentIdx: index('users_department_idx').on(table.department),
  };
}
);

export const usersRelations = relations(users, ({ many }) => ({
    triageSessions: many(triageSessions),
    doctorAssignments: many(doctorAssignments),
   
}));


export const patients = pgTable('patients', {
  patientId: uuid('patient_id').primaryKey().defaultRandom(),
  straId: varchar('stra_id', { length: 20 }).notNull().unique(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  dateOfBirth: date('date_of_birth').notNull(),
  gender: varchar('gender', { length: 10 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 15 }).notNull(),
  emergencyContact: varchar('emergency_contact', { length: 15 }),
  nationalId: varchar('national_id', { length: 50 }),
  address: text('address'),
  ...timestamps,
}, (table) => {
  return {
    straIdIdx: uniqueIndex('patients_stra_id_idx').on(table.straId),
    phoneIdx: index('patients_phone_idx').on(table.phoneNumber),
  };
});

export const patientsRelations = relations(patients, ({ many }) => ({
  triageSessions: many(triageSessions),
  queueEntries: many(departmentQueues),
  prescriptions: many(prescriptions),
  labOrders: many(labOrders),
  doctorAssignments: many(doctorAssignments),
}));


export const departments = pgTable('departments', {
  departmentId: uuid('department_id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  code: varchar('code', { length: 10 }).notNull().unique(),
  currentPatientLoad: integer('current_patient_load').notNull().default(0),
  maxCapacity: integer('max_capacity').notNull().default(50),
  averageTreatmentTime: integer('average_treatment_time').notNull().default(20), // minutes
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => {
  return {
    nameIdx: uniqueIndex('departments_name_idx').on(table.name),
    codeIdx: uniqueIndex('departments_code_idx').on(table.code),
  };
});

export const departmentsRelations = relations(departments, ({ many }) => ({
  queueEntries: many(departmentQueues),
  resources: many(resources),
}));


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
  painScale: integer('pain_scale').notNull(), // 1-10
  symptoms: jsonb('symptoms').notNull().default({}),
  triageScore: integer('triage_score').notNull(),
  urgencyLevel: urgencyLevelEnum('urgency_level').notNull(),
  recommendedDept: varchar('recommended_dept', { length: 50 }).notNull(),
  estimatedWaitMinutes: integer('estimated_wait_minutes').notNull(),
  notes: text('notes'),
  isSynced: boolean('is_synced').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => {
  return {
    patientIdIdx: index('triage_patient_id_idx').on(table.patientId),
    urgencyIdx: index('triage_urgency_idx').on(table.urgencyLevel, table.createdAt),
    nurseIdIdx: index('triage_nurse_id_idx').on(table.nurseId),
  };
});

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

export const departmentQueues = pgTable('department_queues', {
  queueId: uuid('queue_id').primaryKey().defaultRandom(),
  departmentId: uuid('department_id').notNull().references(() => departments.departmentId),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  urgencyLevel: varchar('urgency_level', { length: 10 }).notNull(),
  positionInQueue: integer('position_in_queue').notNull(),
  expectedWaitTime: integer('expected_wait_time').notNull(),
  status: queueStatusEnum('status').notNull().default('WAITING'),
  calledAt: timestamp('called_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  assignedDoctorId: uuid('assigned_doctor_id'),
  ...timestamps,
}, (table) => {
  return {
    deptStatusIdx: index('queue_dept_status_idx').on(table.departmentId, table.status, table.positionInQueue),
    patientIdIdx: index('queue_patient_id_idx').on(table.patientId),
    urgencyIdx: index('queue_urgency_idx').on(table.urgencyLevel),
  };
});

export const departmentQueuesRelations = relations(departmentQueues, ({ one }) => ({
  department: one(departments, {
    fields: [departmentQueues.departmentId],
    references: [departments.departmentId],
  }),
  patient: one(patients, {
    fields: [departmentQueues.patientId],
    references: [patients.patientId],
  }),
}));


export const resources = pgTable('resources', {
  resourceId: uuid('resource_id').primaryKey().defaultRandom(),
  resourceType: resourceTypeEnum('resource_type').notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  model: varchar('model', { length: 100 }),
  serialNumber: varchar('serial_number', { length: 50 }),
  departmentId: uuid('department_id').references(() => departments.departmentId),
  status: resourceStatusEnum('status').notNull().default('AVAILABLE'),
  lastMaintenance: date('last_maintenance'),
  maintenanceIntervalDays: integer('maintenance_interval_days'),
  specifications: jsonb('specifications'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => {
  return {
    deptTypeIdx: index('resources_dept_type_idx').on(table.departmentId, table.resourceType),
    statusIdx: index('resources_status_idx').on(table.status),
  };
});

export const resourcesRelations = relations(resources, ({ one }) => ({
  department: one(departments, {
    fields: [resources.departmentId],
    references: [departments.departmentId],
  }),
}));


export const medicationStock = pgTable('medication_stock', {
  medicationId: uuid('medication_id').primaryKey().defaultRandom(),
  medicationName: varchar('medication_name', { length: 200 }).notNull(),
  genericName: varchar('generic_name', { length: 200 }).notNull(),
  dosageForm: varchar('dosage_form', { length: 50 }).notNull(),
  strength: varchar('strength', { length: 50 }).notNull(),
  currentStock: integer('current_stock').notNull(),
  minimumThreshold: integer('minimum_threshold').notNull(),
  reorderQuantity: integer('reorder_quantity').notNull(),
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }).notNull(),
  lastRestockDate: date('last_restock_date'),
  expiryDate: date('expiry_date'),
  supplierId: uuid('supplier_id'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
}, (table) => {
  return {
    nameIdx: index('medication_name_idx').on(table.medicationName),
    stockIdx: index('medication_stock_idx').on(table.currentStock),
  };
});


export const prescriptions = pgTable('prescriptions', {
  prescriptionId: uuid('prescription_id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  doctorId: uuid('doctor_id').notNull().references(() => users.userId),
  medications: jsonb('medications').notNull(),
  diagnosis: text('diagnosis'),
  notes: text('notes'),
  isDispensed: boolean('is_dispensed').notNull().default(false),
  dispensedAt: timestamp('dispensed_at'),
  dispensedBy: uuid('dispensed_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => {
  return {
    patientIdIdx: index('prescriptions_patient_id_idx').on(table.patientId),
    doctorIdIdx: index('prescriptions_doctor_id_idx').on(table.doctorId),
    createdIdx: index('prescriptions_created_idx').on(table.createdAt),
  };
});

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



export const labOrders = pgTable('lab_orders', {
  orderId: uuid('order_id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  doctorId: uuid('doctor_id').notNull().references(() => users.userId),
  tests: jsonb('tests').notNull(),
  status: labOrderStatusEnum('status').notNull().default('PENDING'),
  orderedAt: timestamp('ordered_at').notNull().defaultNow(),
  collectedAt: timestamp('collected_at'),
  completedAt: timestamp('completed_at'),
  collectedBy: uuid('collected_by'),
  completedBy: uuid('completed_by'),
  results: jsonb('results'),
  interpretation: text('interpretation'),
  isCritical: boolean('is_critical').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => {
  return {
    patientIdIdx: index('lab_orders_patient_id_idx').on(table.patientId),
    statusIdx: index('lab_orders_status_idx').on(table.status),
    criticalIdx: index('lab_orders_critical_idx').on(table.isCritical),
  };
});

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



export const doctorAssignments = pgTable('doctor_assignments', {
  assignmentId: uuid('assignment_id').primaryKey().defaultRandom(),
  doctorId: uuid('doctor_id').notNull().references(() => users.userId),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  assignedAt: timestamp('assigned_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => {
  return {
    doctorPatientIdx: index('assignments_doctor_patient_idx').on(table.doctorId, table.patientId),
    statusIdx: index('assignments_status_idx').on(table.status),
  };
});

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



export const diagnosticImaging = pgTable('diagnostic_imaging', {
  imagingId: uuid('imaging_id').primaryKey().defaultRandom(),
  patientId: uuid('patient_id').notNull().references(() => patients.patientId, { onDelete: 'cascade' }),
  doctorId: uuid('doctor_id').notNull().references(() => users.userId),
  modality: varchar('modality', { length: 50 }).notNull(),
  bodyPart: varchar('body_part', { length: 100 }).notNull(),
  clinicalIndication: text('clinical_indication').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  scheduledTime: timestamp('scheduled_time'),
  completedAt: timestamp('completed_at'),
  findings: text('findings'),
  impression: text('impression'),
  radiologistId: uuid('radiologist_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => {
  return {
    patientIdIdx: index('imaging_patient_id_idx').on(table.patientId),
    statusIdx: index('imaging_status_idx').on(table.status),
  };
});


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


export const schema = {
  users,
  patients,
  departments,
  triageSessions,
  departmentQueues,
  resources,
  medicationStock,
  prescriptions,
  labOrders,
  doctorAssignments,
  diagnosticImaging,
};