CREATE TABLE "template_assignments" (
  "cycle_id" text NOT NULL REFERENCES "cycles"("id"),
  "employee_no" text NOT NULL REFERENCES "employees"("employee_no"),
  "template_id" text NOT NULL REFERENCES "indicator_templates"("id"),
  "assigned_by" text NOT NULL REFERENCES "employees"("employee_no"),
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "template_assignments_cycle_id_employee_no_pk" PRIMARY KEY("cycle_id","employee_no")
);
