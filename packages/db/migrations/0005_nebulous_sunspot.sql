CREATE TABLE "company_source_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"url" text NOT NULL,
	"source_type" varchar(32) NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_source_docs" ADD CONSTRAINT "company_source_docs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_source_docs" ADD CONSTRAINT "company_source_docs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_source_docs_company_url_uidx" ON "company_source_docs" USING btree ("company_id","url");--> statement-breakpoint
CREATE INDEX "company_source_docs_org_company_idx" ON "company_source_docs" USING btree ("organization_id","company_id");