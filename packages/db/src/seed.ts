import { closeDb, db } from "./index";
import { seedLedgerwiseWorkspace } from "./seed-data";

async function seed() {
	if (
		process.env.NODE_ENV === "production" &&
		process.env.ALLOW_SEED !== "true"
	) {
		console.error(
			"Refusing to run database seed in production without ALLOW_SEED=true"
		);
		process.exit(1);
	}

	console.log("Seeding Ledgerwise AI SDR database...");

	try {
		const result = await seedLedgerwiseWorkspace(db);
		console.log(`Organization seeded: Ledgerwise (${result.organizationId})`);
		console.log(`Owner account seeded: ${result.ownerEmail}`);
		console.log(`Reviewer account seeded: ${result.reviewerEmail}`);
		console.log(
			"Exa-sourced companies seeded: 30 qualified US e-commerce brands (30 drafts in Review Queue, 0 seeded replies/meetings) + 7 disqualified benchmark cases"
		);
		console.log("Seeding completed successfully.");
	} catch (error) {
		console.error("Seeding failed:", error);
		process.exitCode = 1;
	} finally {
		await closeDb();
	}
}

seed();
