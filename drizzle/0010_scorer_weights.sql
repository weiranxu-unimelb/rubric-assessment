ALTER TABLE "scorer_assignments" ADD COLUMN "weight" numeric(5, 2);
--> statement-breakpoint
WITH ranked AS (
  SELECT id,
    row_number() OVER (PARTITION BY cycle_id, employee_no ORDER BY scorer_employee_no, id) AS position,
    count(*) OVER (PARTITION BY cycle_id, employee_no) AS scorer_count
  FROM scorer_assignments
)
UPDATE scorer_assignments assignment
SET weight = ((10000 / ranked.scorer_count) + CASE WHEN ranked.position <= (10000 % ranked.scorer_count) THEN 1 ELSE 0 END) / 100.0
FROM ranked
WHERE assignment.id = ranked.id;
--> statement-breakpoint
ALTER TABLE "scorer_assignments" ALTER COLUMN "weight" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "scorer_assignments" ADD CONSTRAINT "scorer_assignment_weight_range" CHECK ("weight" > 0 AND "weight" <= 100);
--> statement-breakpoint
ALTER TABLE "score_tasks" ADD COLUMN "weight" numeric(5, 2);
--> statement-breakpoint
UPDATE score_tasks task
SET weight = assignment.weight
FROM assessments assessment, scorer_assignments assignment
WHERE task.assessment_id = assessment.id
  AND assignment.cycle_id = assessment.cycle_id
  AND assignment.employee_no = assessment.employee_no
  AND assignment.scorer_employee_no = task.scorer_employee_no;
--> statement-breakpoint
WITH ranked AS (
  SELECT id,
    row_number() OVER (PARTITION BY assessment_id ORDER BY scorer_employee_no, id) AS position,
    count(*) OVER (PARTITION BY assessment_id) AS scorer_count
  FROM score_tasks
  WHERE weight IS NULL
)
UPDATE score_tasks task
SET weight = ((10000 / ranked.scorer_count) + CASE WHEN ranked.position <= (10000 % ranked.scorer_count) THEN 1 ELSE 0 END) / 100.0
FROM ranked
WHERE task.id = ranked.id;
--> statement-breakpoint
ALTER TABLE "score_tasks" ALTER COLUMN "weight" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "score_tasks" ADD CONSTRAINT "score_task_weight_range" CHECK ("weight" > 0 AND "weight" <= 100);
