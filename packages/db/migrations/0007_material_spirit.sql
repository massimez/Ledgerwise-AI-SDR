ALTER TABLE "research_runs" ADD COLUMN "exa_suggested_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "pre_filtered_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "research_runs" ADD COLUMN "pre_filtered_breakdown" jsonb DEFAULT '{"duplicateDomain":0,"duplicateUrl":0,"icpPreScreen":0,"unresolvedDomain":0}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "research_runs" SET "exa_suggested_count" = "found_count" WHERE "exa_suggested_count" = 0 AND "found_count" > 0;