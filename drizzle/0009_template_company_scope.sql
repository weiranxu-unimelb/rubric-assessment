ALTER TABLE "indicator_templates" ADD COLUMN "company_id" text;
--> statement-breakpoint
UPDATE "indicator_templates" t
SET "company_id" = s."company_id"
FROM "employees" e JOIN "subsidiaries" s ON s."id" = e."subsidiary_id"
WHERE e."employee_no" = t."created_by";
--> statement-breakpoint
ALTER TABLE "indicator_templates" ALTER COLUMN "company_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "indicator_templates" ADD CONSTRAINT "indicator_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "indicator_templates_company_idx" ON "indicator_templates" USING btree ("company_id");
