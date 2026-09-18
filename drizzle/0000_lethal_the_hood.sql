CREATE TABLE "admin_scopes" (
	"admin_employee_no" text NOT NULL,
	"subsidiary_id" text NOT NULL,
	CONSTRAINT "admin_scopes_admin_employee_no_subsidiary_id_pk" PRIMARY KEY("admin_employee_no","subsidiary_id")
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"employee_no" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"final_score" numeric(5, 2),
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "assessment_cycle_employee_unique" UNIQUE("cycle_id","employee_no")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_employee_no" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"employee_no" text PRIMARY KEY NOT NULL,
	"subsidiary_id" text NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"phone" text,
	"password_hash" text NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"key" text PRIMARY KEY NOT NULL,
	"actor_employee_no" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indicator_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"assessment_id" text NOT NULL,
	"parent_id" text,
	"node_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"max_score" numeric(6, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"self_content" text DEFAULT '' NOT NULL,
	"admin_feedback" text DEFAULT '' NOT NULL,
	CONSTRAINT "indicator_assessment_code_unique" UNIQUE("assessment_id","node_code")
);
--> statement-breakpoint
CREATE TABLE "score_items" (
	"task_id" text NOT NULL,
	"node_id" text NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	CONSTRAINT "score_items_task_id_node_id_pk" PRIMARY KEY("task_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "score_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"assessment_id" text NOT NULL,
	"scorer_employee_no" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"total_score" numeric(5, 2),
	"submitted_at" timestamp with time zone,
	CONSTRAINT "score_task_assessment_scorer_unique" UNIQUE("assessment_id","scorer_employee_no")
);
--> statement-breakpoint
CREATE TABLE "scorer_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"employee_no" text NOT NULL,
	"scorer_employee_no" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "scorer_assignment_unique" UNIQUE("cycle_id","employee_no","scorer_employee_no")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"employee_no" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subsidiaries" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_scopes" ADD CONSTRAINT "admin_scopes_admin_employee_no_employees_employee_no_fk" FOREIGN KEY ("admin_employee_no") REFERENCES "public"."employees"("employee_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_scopes" ADD CONSTRAINT "admin_scopes_subsidiary_id_subsidiaries_id_fk" FOREIGN KEY ("subsidiary_id") REFERENCES "public"."subsidiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_employee_no_employees_employee_no_fk" FOREIGN KEY ("employee_no") REFERENCES "public"."employees"("employee_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_employee_no_employees_employee_no_fk" FOREIGN KEY ("actor_employee_no") REFERENCES "public"."employees"("employee_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_subsidiary_id_subsidiaries_id_fk" FOREIGN KEY ("subsidiary_id") REFERENCES "public"."subsidiaries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_employee_no_employees_employee_no_fk" FOREIGN KEY ("actor_employee_no") REFERENCES "public"."employees"("employee_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indicator_nodes" ADD CONSTRAINT "indicator_nodes_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_items" ADD CONSTRAINT "score_items_task_id_score_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."score_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_items" ADD CONSTRAINT "score_items_node_id_indicator_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."indicator_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_tasks" ADD CONSTRAINT "score_tasks_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_tasks" ADD CONSTRAINT "score_tasks_scorer_employee_no_employees_employee_no_fk" FOREIGN KEY ("scorer_employee_no") REFERENCES "public"."employees"("employee_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorer_assignments" ADD CONSTRAINT "scorer_assignments_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorer_assignments" ADD CONSTRAINT "scorer_assignments_employee_no_employees_employee_no_fk" FOREIGN KEY ("employee_no") REFERENCES "public"."employees"("employee_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorer_assignments" ADD CONSTRAINT "scorer_assignments_scorer_employee_no_employees_employee_no_fk" FOREIGN KEY ("scorer_employee_no") REFERENCES "public"."employees"("employee_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_employee_no_employees_employee_no_fk" FOREIGN KEY ("employee_no") REFERENCES "public"."employees"("employee_no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subsidiaries" ADD CONSTRAINT "subsidiaries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_status_idx" ON "assessments" USING btree ("cycle_id","status");--> statement-breakpoint
CREATE INDEX "indicator_assessment_idx" ON "indicator_nodes" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "score_task_scorer_idx" ON "score_tasks" USING btree ("scorer_employee_no","status");