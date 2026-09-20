ALTER TABLE "assessments" ADD COLUMN "template_id" text REFERENCES "indicator_templates"("id");
