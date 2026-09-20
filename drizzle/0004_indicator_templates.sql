CREATE TABLE "indicator_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "min_indicators" integer DEFAULT 1 NOT NULL,
  "max_indicators" integer DEFAULT 10 NOT NULL,
  "created_by" text NOT NULL REFERENCES "employees"("employee_no"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indicator_template_nodes" (
  "id" text PRIMARY KEY NOT NULL,
  "template_id" text NOT NULL REFERENCES "indicator_templates"("id"),
  "name" text DEFAULT '' NOT NULL,
  "deduction_rule" text DEFAULT '' NOT NULL,
  "max_score" numeric(6, 2),
  "sort_order" integer DEFAULT 0 NOT NULL
);
