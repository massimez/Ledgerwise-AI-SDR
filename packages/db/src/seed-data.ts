import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { and, eq, isNull, like, sql } from "drizzle-orm";
import type { Database } from "./index";
import {
	account,
	agentRuns,
	companies,
	companySourceDocs,
	contacts,
	evidence,
	meetings,
	member,
	messages,
	NOTIFICATION_CATEGORIES,
	NOTIFICATION_CHANNELS,
	notificationPreference,
	organization,
	organizationStorageLimits,
	qualificationCriteria,
	researchRuns,
	sdrSettings,
	suppressions,
	threads,
	user,
} from "./schema";
import {
	DEFAULT_LEDGERWISE_ICP,
	DEFAULT_LEDGERWISE_PLAYBOOK,
	LEDGERWISE_ORG_ID,
	LEDGERWISE_ORG_SLUG,
	LEDGERWISE_OWNER_USER_ID,
	LEDGERWISE_REVIEWER_USER_ID,
} from "./sdr-defaults";
import {
	type BuiltSdrSeedDataset,
	buildEvalBackedSdrSeedDataset,
	SEED_RESEARCH_RUN_ID,
} from "./seed-sdr-dataset";

type SeedTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function insertSdrDataset(
	tx: SeedTx,
	dataset: BuiltSdrSeedDataset
): Promise<void> {
	if (dataset.companies.length > 0) {
		await tx.insert(companies).values(dataset.companies).onConflictDoNothing();
	}
	if (dataset.evidence.length > 0) {
		await tx.insert(evidence).values(dataset.evidence).onConflictDoNothing();
	}
	if (dataset.companySourceDocs.length > 0) {
		await tx
			.insert(companySourceDocs)
			.values(dataset.companySourceDocs)
			.onConflictDoNothing();
	}
	if (dataset.qualificationCriteria.length > 0) {
		await tx
			.insert(qualificationCriteria)
			.values(dataset.qualificationCriteria)
			.onConflictDoNothing();
	}
	if (dataset.contacts.length > 0) {
		await tx.insert(contacts).values(dataset.contacts).onConflictDoNothing();
	}
	if (dataset.threads.length > 0) {
		await tx.insert(threads).values(dataset.threads).onConflictDoNothing();
	}
	if (dataset.messages.length > 0) {
		await tx.insert(messages).values(dataset.messages).onConflictDoNothing();
	}
	if (dataset.meetings.length > 0) {
		await tx.insert(meetings).values(dataset.meetings).onConflictDoNothing();
	}
	if (dataset.suppressions.length > 0) {
		await tx
			.insert(suppressions)
			.values(dataset.suppressions)
			.onConflictDoUpdate({
				set: {
					companyId: sql`excluded.company_id`,
					sourceMessageId: sql`excluded.source_message_id`,
				},
				target: [suppressions.organizationId, suppressions.email],
			});
	}
	if (dataset.agentRuns.length > 0) {
		await tx.insert(agentRuns).values(dataset.agentRuns).onConflictDoNothing();
	}
}

function hashBetterAuthPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	return new Promise((resolve, reject) => {
		scryptCallback(
			password.normalize("NFKC"),
			salt,
			64,
			{
				N: 16_384,
				r: 16,
				p: 1,
				maxmem: 128 * 16_384 * 16 * 2,
			},
			(err, derivedKey) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(`${salt}:${derivedKey.toString("hex")}`);
			}
		);
	});
}

export async function seedLedgerwiseWorkspace(
	database: Database,
	options: { resetExistingSdrData?: boolean } = {}
): Promise<{
	organizationId: string;
	ownerEmail: string;
	reviewerEmail: string;
}> {
	const shouldSeedCredentials = !options.resetExistingSdrData;
	let passwordHash: string | null = null;
	if (shouldSeedCredentials) {
		const envPassword = process.env.DEMO_USER_PASSWORD?.trim();
		if (process.env.NODE_ENV === "production" && !envPassword) {
			throw new Error(
				"DEMO_USER_PASSWORD must be explicitly configured when seeding credential accounts in production."
			);
		}
		passwordHash = await hashBetterAuthPassword(
			envPassword || "Ledgerwise2026!"
		);
	}

	const demoOrgId = "org_demo_acme";
	const demoUserId = "usr_demo_admin";
	const demoMemberId = "mem_demo_admin";
	const dataset = buildEvalBackedSdrSeedDataset();

	await database.transaction(async (tx) => {
		if (shouldSeedCredentials && passwordHash) {
			// 1. Preserve legacy Acme starter user/org for existing unit/integration tests
			await tx
				.insert(user)
				.values({
					email: "admin@acme.example",
					emailVerified: true,
					firstName: "Acme",
					id: demoUserId,
					lastName: "Admin",
					locale: "en",
					name: "Acme Admin",
					role: "user",
				})
				.onConflictDoNothing();

			await tx
				.insert(organization)
				.values({
					id: demoOrgId,
					name: "Acme Corporation",
					slug: "acme-corp",
				})
				.onConflictDoNothing();

			await tx
				.insert(member)
				.values({
					id: demoMemberId,
					organizationId: demoOrgId,
					role: "owner",
					userId: demoUserId,
				})
				.onConflictDoNothing();

			await tx
				.update(user)
				.set({ defaultOrganizationId: demoOrgId })
				.where(
					and(eq(user.id, demoUserId), isNull(user.defaultOrganizationId))
				);

			await tx
				.insert(organizationStorageLimits)
				.values({
					currentUsage: 0,
					organizationId: demoOrgId,
					storageLimit: 1024 * 1024 * 1024,
				})
				.onConflictDoNothing();

			// 2. Seed Ledgerwise organization and sales team users
			await tx
				.insert(organization)
				.values({
					id: LEDGERWISE_ORG_ID,
					name: "Ledgerwise",
					slug: LEDGERWISE_ORG_SLUG,
				})
				.onConflictDoNothing();

			await tx
				.insert(organizationStorageLimits)
				.values({
					currentUsage: 0,
					organizationId: LEDGERWISE_ORG_ID,
					storageLimit: 1024 * 1024 * 1024,
				})
				.onConflictDoNothing();

			await tx
				.insert(user)
				.values([
					{
						defaultOrganizationId: LEDGERWISE_ORG_ID,
						email: "dana@ledgerwise.demo",
						emailVerified: true,
						firstName: "Dana",
						id: LEDGERWISE_OWNER_USER_ID,
						lastName: "Mercer",
						locale: "en",
						name: "Dana Mercer",
						role: "user",
					},
					{
						defaultOrganizationId: LEDGERWISE_ORG_ID,
						email: "reviewer@ledgerwise.demo",
						emailVerified: true,
						firstName: "Unscale",
						id: LEDGERWISE_REVIEWER_USER_ID,
						lastName: "Reviewer",
						locale: "en",
						name: "Unscale Reviewer",
						role: "user",
					},
				])
				.onConflictDoNothing();

			// Ensure credential accounts exist so both users can sign in with email + password
			await tx
				.insert(account)
				.values([
					{
						accountId: LEDGERWISE_OWNER_USER_ID,
						id: "acc_ledgerwise_dana",
						password: passwordHash,
						providerId: "credential",
						userId: LEDGERWISE_OWNER_USER_ID,
					},
					{
						accountId: LEDGERWISE_REVIEWER_USER_ID,
						id: "acc_ledgerwise_reviewer",
						password: passwordHash,
						providerId: "credential",
						userId: LEDGERWISE_REVIEWER_USER_ID,
					},
				])
				.onConflictDoNothing();

			await tx
				.insert(member)
				.values([
					{
						id: "mem_ledgerwise_dana",
						organizationId: LEDGERWISE_ORG_ID,
						role: "owner",
						userId: LEDGERWISE_OWNER_USER_ID,
					},
					{
						id: "mem_ledgerwise_reviewer",
						organizationId: LEDGERWISE_ORG_ID,
						role: "admin",
						userId: LEDGERWISE_REVIEWER_USER_ID,
					},
					{
						id: "mem_ledgerwise_acme_admin",
						organizationId: LEDGERWISE_ORG_ID,
						role: "admin",
						userId: demoUserId,
					},
				])
				.onConflictDoNothing();

			const allSeededUsers = [
				demoUserId,
				LEDGERWISE_OWNER_USER_ID,
				LEDGERWISE_REVIEWER_USER_ID,
			];
			const prefRows = allSeededUsers.flatMap((uid) =>
				NOTIFICATION_CATEGORIES.flatMap((category) =>
					NOTIFICATION_CHANNELS.map((channel) => ({
						category,
						channel,
						enabled: true,
						userId: uid,
					}))
				)
			);

			await tx
				.insert(notificationPreference)
				.values(prefRows)
				.onConflictDoNothing();
		}

		// Clean up any leftover isolated eval organizations (.eval.local records)
		await tx.delete(organization).where(like(organization.id, "eval_org_%"));

		// Detach company/message references on permanent suppressions before replacing demo rows
		// so opt-out and bounce suppressions are preserved (Domain Invariant #3).
		await tx
			.update(suppressions)
			.set({ companyId: null, sourceMessageId: null })
			.where(eq(suppressions.organizationId, LEDGERWISE_ORG_ID));

		// Delete leaf/referencing tables before parents to avoid PostgreSQL
		// multi-path CASCADE + ON DELETE SET NULL FK trigger conflicts.
		await tx
			.delete(agentRuns)
			.where(eq(agentRuns.organizationId, LEDGERWISE_ORG_ID));
		await tx
			.delete(meetings)
			.where(eq(meetings.organizationId, LEDGERWISE_ORG_ID));
		await tx
			.delete(messages)
			.where(eq(messages.organizationId, LEDGERWISE_ORG_ID));
		await tx
			.delete(threads)
			.where(eq(threads.organizationId, LEDGERWISE_ORG_ID));
		await tx
			.delete(contacts)
			.where(eq(contacts.organizationId, LEDGERWISE_ORG_ID));
		await tx
			.delete(qualificationCriteria)
			.where(eq(qualificationCriteria.organizationId, LEDGERWISE_ORG_ID));
		await tx
			.delete(companySourceDocs)
			.where(eq(companySourceDocs.organizationId, LEDGERWISE_ORG_ID));
		await tx
			.delete(evidence)
			.where(eq(evidence.organizationId, LEDGERWISE_ORG_ID));
		await tx
			.delete(companies)
			.where(eq(companies.organizationId, LEDGERWISE_ORG_ID));
		await tx
			.delete(researchRuns)
			.where(eq(researchRuns.organizationId, LEDGERWISE_ORG_ID));

		// 3. Seed Ledgerwise SDR Playbook & Settings
		await tx
			.insert(sdrSettings)
			.values({
				aiDisclosure: "when_asked",
				autopilot: "replies_auto",
				dailySendCap: 50,
				icp: DEFAULT_LEDGERWISE_ICP,
				organizationId: LEDGERWISE_ORG_ID,
				playbook: DEFAULT_LEDGERWISE_PLAYBOOK,
				senderName: "Dana Mercer",
				senderTitle: "Head of Partnerships, Ledgerwise",
				sendWindow: {
					daysOfWeek: [1, 2, 3, 4, 5],
					endHourEt: 18,
					startHourEt: 8,
				},
				signature: "Best,\nDana Mercer\nHead of Partnerships, Ledgerwise",
			})
			.onConflictDoUpdate({
				set: {
					icp: DEFAULT_LEDGERWISE_ICP,
					playbook: DEFAULT_LEDGERWISE_PLAYBOOK,
				},
				target: sdrSettings.organizationId,
			});

		// 4. Seed completed Research Run reflecting the 37 researched / 30 qualified companies
		await tx
			.insert(researchRuns)
			.values({
				completedAt: new Date("2026-11-15T00:26:00.000Z"),
				exaSuggestedCount: dataset.companies.length,
				foundCount: dataset.companies.length,
				id: SEED_RESEARCH_RUN_ID,
				organizationId: LEDGERWISE_ORG_ID,
				preFilteredBreakdown: {
					duplicateDomain: 0,
					duplicateUrl: 0,
					icpPreScreen: 0,
					unresolvedDomain: 0,
				},
				preFilteredCount: 0,
				qualifiedCount: 30,
				querySet: [
					"US Shopify brand hiring Controller or Senior Accountant",
					"DTC ecommerce brand raised seed or Series A round 2026",
					"Shopify Plus brand expanding into Amazon FBA and retail wholesale",
				],
				researchedCount: dataset.companies.length,
				startedBy: LEDGERWISE_OWNER_USER_ID,
				status: "completed",
			})
			.onConflictDoNothing();

		// 5. Seed Exa-Sourced Companies, Evidence, Source Docs, Criteria, Contacts, Threads, Messages, Meetings, Suppressions & Agent Runs
		await insertSdrDataset(tx, dataset);
	});

	return {
		organizationId: LEDGERWISE_ORG_ID,
		ownerEmail: "dana@ledgerwise.demo",
		reviewerEmail: "reviewer@ledgerwise.demo",
	};
}
