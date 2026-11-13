CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"message_id" uuid,
	"thread_id" uuid,
	"company_id" uuid,
	"step" varchar(32) NOT NULL,
	"model" varchar(128) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"output" jsonb,
	"decision" varchar(64),
	"guard_results" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"domain" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"website" text NOT NULL,
	"hq_location" varchar(255),
	"channels" text[] DEFAULT '{}'::text[] NOT NULL,
	"signals" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" text,
	"revenue_band" varchar(64) DEFAULT 'unknown' NOT NULL,
	"employee_band" varchar(64) DEFAULT 'unknown' NOT NULL,
	"status" varchar(32) DEFAULT 'discovered' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"tier" varchar(8) DEFAULT 'C' NOT NULL,
	"score_confidence" varchar(16) DEFAULT 'medium' NOT NULL,
	"disqualify_reason" text,
	"research_error" text,
	"last_researched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"title" varchar(160) NOT NULL,
	"persona" varchar(32) DEFAULT 'founder' NOT NULL,
	"email" varchar(255),
	"email_status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"linkedin_url" text,
	"evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"quote" text NOT NULL,
	"claim" text NOT NULL,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verification_method" varchar(32) DEFAULT 'exact' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"thread_id" uuid,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"cal_booking_uid" varchar(128) NOT NULL,
	"title" varchar(255) NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/New_York' NOT NULL,
	"attendee_email" varchar(255) NOT NULL,
	"meeting_url" text,
	"notes" text,
	"status" varchar(32) DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_cal_booking_uid_unique" UNIQUE("cal_booking_uid")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"direction" varchar(16) NOT NULL,
	"author" varchar(16) NOT NULL,
	"status" varchar(32) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"body_text" text NOT NULL,
	"ai_original_body" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fact_check" jsonb,
	"classification" jsonb,
	"decision_summary" text,
	"reject_reason" text,
	"approved_by" text,
	"provider_message_id" varchar(255),
	"in_reply_to" varchar(255),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"criterion" varchar(64) NOT NULL,
	"verdict" varchar(16) NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"max_points" integer DEFAULT 0 NOT NULL,
	"rationale" text NOT NULL,
	"evidence_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"query_set" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"found_count" integer DEFAULT 0 NOT NULL,
	"researched_count" integer DEFAULT 0 NOT NULL,
	"qualified_count" integer DEFAULT 0 NOT NULL,
	"started_by" text,
	"error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sdr_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"playbook" jsonb NOT NULL,
	"icp" jsonb NOT NULL,
	"autopilot" varchar(32) DEFAULT 'replies_auto' NOT NULL,
	"ai_disclosure" varchar(32) DEFAULT 'when_asked' NOT NULL,
	"sender_name" varchar(120) DEFAULT 'Dana Mercer' NOT NULL,
	"sender_title" varchar(120) DEFAULT 'Account Executive, Ledgerwise' NOT NULL,
	"signature" text NOT NULL,
	"daily_send_cap" integer DEFAULT 50 NOT NULL,
	"send_window" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" uuid,
	"email" varchar(255) NOT NULL,
	"domain" varchar(255),
	"reason" varchar(32) DEFAULT 'opt_out' NOT NULL,
	"source_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"ai_mode" varchar(16) DEFAULT 'auto' NOT NULL,
	"pending_job_id" varchar(128),
	"prospect_timezone" varchar(64) DEFAULT 'America/New_York' NOT NULL,
	"owner_user_id" text,
	"handoff_reason" text,
	"reply_token" varchar(64) NOT NULL,
	"offered_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ai_reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threads_reply_token_unique" UNIQUE("reply_token")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_criteria" ADD CONSTRAINT "qualification_criteria_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_criteria" ADD CONSTRAINT "qualification_criteria_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdr_settings" ADD CONSTRAINT "sdr_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_org_created_idx" ON "agent_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_thread_idx" ON "agent_runs" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "agent_runs_company_idx" ON "agent_runs" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_org_domain_uidx" ON "companies" USING btree ("organization_id","domain");--> statement-breakpoint
CREATE INDEX "companies_org_tier_score_idx" ON "companies" USING btree ("organization_id","tier","score");--> statement-breakpoint
CREATE INDEX "companies_org_status_idx" ON "companies" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "contacts_org_company_idx" ON "contacts" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE INDEX "evidence_org_company_idx" ON "evidence" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE INDEX "evidence_company_verified_idx" ON "evidence" USING btree ("company_id","verified");--> statement-breakpoint
CREATE INDEX "meetings_org_start_idx" ON "meetings" USING btree ("organization_id","start_at");--> statement-breakpoint
CREATE INDEX "meetings_org_status_idx" ON "meetings" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_org_status_idx" ON "messages" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_msg_id_uidx" ON "messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_criteria_company_criterion_uidx" ON "qualification_criteria" USING btree ("company_id","criterion");--> statement-breakpoint
CREATE INDEX "qualification_criteria_org_company_idx" ON "qualification_criteria" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE INDEX "research_runs_org_created_idx" ON "research_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_org_email_uidx" ON "suppressions" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "suppressions_org_company_idx" ON "suppressions" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE INDEX "threads_org_status_last_msg_idx" ON "threads" USING btree ("organization_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "threads_org_company_idx" ON "threads" USING btree ("organization_id","company_id");