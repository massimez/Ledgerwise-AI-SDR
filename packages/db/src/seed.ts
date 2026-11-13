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
			"Sample companies seeded: Suncrest Botanics (85 A, Review Queue), Harbor & Loom (75 A, Active Thread), Trailhead Kettle Co. (80 A, Booked Call), Kova Athletic (65 B, Needs Human)"
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
