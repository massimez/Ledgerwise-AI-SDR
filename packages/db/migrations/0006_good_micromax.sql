DROP INDEX "threads_org_company_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "threads_org_company_uidx" ON "threads" USING btree ("organization_id","company_id");