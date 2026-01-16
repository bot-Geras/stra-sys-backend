CREATE TYPE "public"."lab_order_status" AS ENUM('PENDING', 'COLLECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."queue_status" AS ENUM('WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'OUT_OF_SERVICE');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('BED', 'VENTILATOR', 'MONITOR', 'DEFIBRILLATOR', 'INFUSION_PUMP');--> statement-breakpoint
CREATE TYPE "public"."urgency_level" AS ENUM('RED', 'YELLOW', 'GREEN');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'doctor', 'nurse', 'pharmacist', 'management');--> statement-breakpoint
CREATE TABLE "department_queues" (
	"queue_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"urgency_level" varchar(10) NOT NULL,
	"position_in_queue" integer NOT NULL,
	"expected_wait_time" integer NOT NULL,
	"status" "queue_status" DEFAULT 'WAITING' NOT NULL,
	"called_at" timestamp,
	"started_at" timestamp,
	"completed_at" timestamp,
	"assigned_doctor_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"department_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"code" varchar(10) NOT NULL,
	"current_patient_load" integer DEFAULT 0 NOT NULL,
	"max_capacity" integer DEFAULT 50 NOT NULL,
	"average_treatment_time" integer DEFAULT 20 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "departments_name_unique" UNIQUE("name"),
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "diagnostic_imaging" (
	"imaging_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"modality" varchar(50) NOT NULL,
	"body_part" varchar(100) NOT NULL,
	"clinical_indication" text NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"scheduled_time" timestamp,
	"completed_at" timestamp,
	"findings" text,
	"impression" text,
	"radiologist_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_assignments" (
	"assignment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_orders" (
	"order_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"tests" jsonb NOT NULL,
	"status" "lab_order_status" DEFAULT 'PENDING' NOT NULL,
	"ordered_at" timestamp DEFAULT now() NOT NULL,
	"collected_at" timestamp,
	"completed_at" timestamp,
	"collected_by" uuid,
	"completed_by" uuid,
	"results" jsonb,
	"interpretation" text,
	"is_critical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication_stock" (
	"medication_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"medication_name" varchar(200) NOT NULL,
	"generic_name" varchar(200) NOT NULL,
	"dosage_form" varchar(50) NOT NULL,
	"strength" varchar(50) NOT NULL,
	"current_stock" integer NOT NULL,
	"minimum_threshold" integer NOT NULL,
	"reorder_quantity" integer NOT NULL,
	"unit_cost" numeric(10, 2) NOT NULL,
	"last_restock_date" date,
	"expiry_date" date,
	"supplier_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"patient_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stra_id" varchar(20) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"date_of_birth" date NOT NULL,
	"gender" varchar(10) NOT NULL,
	"phone_number" varchar(15) NOT NULL,
	"emergency_contact" varchar(15),
	"national_id" varchar(50),
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patients_stra_id_unique" UNIQUE("stra_id")
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"prescription_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"medications" jsonb NOT NULL,
	"diagnosis" text,
	"notes" text,
	"is_dispensed" boolean DEFAULT false NOT NULL,
	"dispensed_at" timestamp,
	"dispensed_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"resource_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" "resource_type" NOT NULL,
	"name" varchar(100) NOT NULL,
	"model" varchar(100),
	"serial_number" varchar(50),
	"department_id" uuid,
	"status" "resource_status" DEFAULT 'AVAILABLE' NOT NULL,
	"last_maintenance" date,
	"maintenance_interval_days" integer,
	"specifications" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "triage_sessions" (
	"session_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"nurse_id" uuid NOT NULL,
	"temperature" numeric(4, 2),
	"systolic_bp" integer,
	"diastolic_bp" integer,
	"heart_rate" integer,
	"respiratory_rate" integer,
	"oxygen_saturation" numeric(4, 2),
	"pain_scale" integer NOT NULL,
	"symptoms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"triage_score" integer NOT NULL,
	"urgency_level" "urgency_level" NOT NULL,
	"recommended_dept" varchar(50) NOT NULL,
	"estimated_wait_minutes" integer NOT NULL,
	"notes" text,
	"is_synced" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"role" "user_role" DEFAULT 'nurse' NOT NULL,
	"department" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"phone_number" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "department_queues" ADD CONSTRAINT "department_queues_department_id_departments_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_queues" ADD CONSTRAINT "department_queues_patient_id_patients_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("patient_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_imaging" ADD CONSTRAINT "diagnostic_imaging_patient_id_patients_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("patient_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_imaging" ADD CONSTRAINT "diagnostic_imaging_doctor_id_users_user_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_assignments" ADD CONSTRAINT "doctor_assignments_doctor_id_users_user_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_assignments" ADD CONSTRAINT "doctor_assignments_patient_id_patients_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("patient_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_patient_id_patients_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("patient_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_doctor_id_users_user_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("patient_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_users_user_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_department_id_departments_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("department_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_sessions" ADD CONSTRAINT "triage_sessions_patient_id_patients_patient_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("patient_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "triage_sessions" ADD CONSTRAINT "triage_sessions_nurse_id_users_user_id_fk" FOREIGN KEY ("nurse_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queue_dept_status_idx" ON "department_queues" USING btree ("department_id","status","position_in_queue");--> statement-breakpoint
CREATE INDEX "queue_patient_id_idx" ON "department_queues" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "queue_urgency_idx" ON "department_queues" USING btree ("urgency_level");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_idx" ON "departments" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_code_idx" ON "departments" USING btree ("code");--> statement-breakpoint
CREATE INDEX "imaging_patient_id_idx" ON "diagnostic_imaging" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "imaging_status_idx" ON "diagnostic_imaging" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assignments_doctor_patient_idx" ON "doctor_assignments" USING btree ("doctor_id","patient_id");--> statement-breakpoint
CREATE INDEX "assignments_status_idx" ON "doctor_assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lab_orders_patient_id_idx" ON "lab_orders" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "lab_orders_status_idx" ON "lab_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lab_orders_critical_idx" ON "lab_orders" USING btree ("is_critical");--> statement-breakpoint
CREATE INDEX "medication_name_idx" ON "medication_stock" USING btree ("medication_name");--> statement-breakpoint
CREATE INDEX "medication_stock_idx" ON "medication_stock" USING btree ("current_stock");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_stra_id_idx" ON "patients" USING btree ("stra_id");--> statement-breakpoint
CREATE INDEX "patients_phone_idx" ON "patients" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "prescriptions_patient_id_idx" ON "prescriptions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "prescriptions_doctor_id_idx" ON "prescriptions" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "prescriptions_created_idx" ON "prescriptions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "resources_dept_type_idx" ON "resources" USING btree ("department_id","resource_type");--> statement-breakpoint
CREATE INDEX "resources_status_idx" ON "resources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "triage_patient_id_idx" ON "triage_sessions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "triage_urgency_idx" ON "triage_sessions" USING btree ("urgency_level","created_at");--> statement-breakpoint
CREATE INDEX "triage_nurse_id_idx" ON "triage_sessions" USING btree ("nurse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_department_idx" ON "users" USING btree ("department");