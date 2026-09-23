CREATE TYPE "employee_rank" AS ENUM ('EMPLOYEE', 'DEPUTY_GENERAL_MANAGER', 'GENERAL_MANAGER');
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "rank" "employee_rank" NOT NULL DEFAULT 'EMPLOYEE';
--> statement-breakpoint
CREATE TABLE "department_scorer_presets" (
  "subsidiary_id" text NOT NULL REFERENCES "subsidiaries"("id"),
  "department" text NOT NULL,
  "general_manager_factor" integer NOT NULL DEFAULT 3,
  "deputy_general_manager_factor" integer NOT NULL DEFAULT 2,
  "employee_factor" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "department_scorer_presets_subsidiary_id_department_pk" PRIMARY KEY ("subsidiary_id", "department"),
  CONSTRAINT "department_scorer_preset_name" CHECK (length(btrim("department")) > 0),
  CONSTRAINT "department_scorer_preset_factors" CHECK (
    "general_manager_factor" BETWEEN 1 AND 100 AND
    "deputy_general_manager_factor" BETWEEN 1 AND 100 AND
    "employee_factor" BETWEEN 1 AND 100
  )
);
