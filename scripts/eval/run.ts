import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
	configureExaTelemetry,
	configureSdrLlmExecution,
	GEMINI_FALLBACK_MODELS,
} from "../../packages/ai-core/src/index";
import { closeEvalDb, createIsolatedEvalDbContext } from "./db-isolation";
import {
	computeUnitEconomicsSummary,
	renderMarkdownEvaluationReport,
} from "./report";
import { runDiscoveryEvalSuite } from "./suites/discovery";
import { runEmailsEvalSuite } from "./suites/emails";
import { runIcpEvalSuite } from "./suites/icp";
import { runRepliesEvalSuite } from "./suites/replies";
import type {
	EvalSuiteSelection,
	FullEvaluationReport,
	SuiteEvaluationResult,
} from "./types";

const VALID_SUITES = new Set<EvalSuiteSelection>([
	"all",
	"discovery",
	"icp",
	"emails",
	"replies",
]);

function parseCliArgs(argv: string[]): {
	rpm: number;
	suite: EvalSuiteSelection;
} {
	const { values } = parseArgs({
		args: argv,
		options: {
			rpm: { default: "12", type: "string" },
			suite: { default: "all", type: "string" },
		},
		strict: false,
	});

	const rawSuite = String(values.suite ?? "all") as EvalSuiteSelection;
	if (!VALID_SUITES.has(rawSuite)) {
		throw new Error(
			`Invalid --suite value "${rawSuite}". Expected: all | discovery | icp | emails | replies`
		);
	}

	const parsedRpm = Number(values.rpm ?? "12");
	if (!(Number.isFinite(parsedRpm) && parsedRpm > 0)) {
		throw new Error(
			`Invalid --rpm value "${String(values.rpm)}". Expected positive integer.`
		);
	}

	return { rpm: Math.trunc(parsedRpm), suite: rawSuite };
}

async function main(): Promise<void> {
	const cli = parseCliArgs(process.argv.slice(2));
	process.stdout.write(
		`\n[Eval] Starting Ledgerwise AI SDR Evaluation Harness (suite=${cli.suite}, rpm=${cli.rpm})\n`
	);

	const dbContext = await createIsolatedEvalDbContext();
	const suites: SuiteEvaluationResult[] = [];
	let cleanupStats = {
		after: { companyCount: 0, threadCount: 0 },
		before: { companyCount: 0, threadCount: 0 },
		isolatedOrgCleanedUp: false,
		liveDemoDataUnchanged: false,
	};

	try {
		if (cli.suite === "all" || cli.suite === "discovery") {
			process.stdout.write(
				"[Eval] Running Suite 1 — Research & Discovery Quality (15 candidates across 3 presets)...\n"
			);
			const res = await runDiscoveryEvalSuite({
				dbContext,
				rpm: cli.rpm,
			});
			suites.push(res);
			process.stdout.write(
				`[Eval] Suite 1 complete: ${res.passedCases}/${res.totalCases} (${res.passRatePct.toFixed(1)}%), avg=${res.latency.avgMs}ms, p95=${res.latency.p95Ms}ms\n`
			);
		}

		if (cli.suite === "all" || cli.suite === "icp") {
			process.stdout.write(
				"[Eval] Running Suite 2 — Qualification & Regex-vs-LLM Benchmark (15 labeled cases)...\n"
			);
			const res = await runIcpEvalSuite({ rpm: cli.rpm });
			suites.push(res);
			process.stdout.write(
				`[Eval] Suite 2 complete: ${res.passedCases}/${res.totalCases} (${res.passRatePct.toFixed(1)}%), avg=${res.latency.avgMs}ms, p95=${res.latency.p95Ms}ms\n`
			);
		}

		if (cli.suite === "all" || cli.suite === "emails") {
			process.stdout.write(
				"[Eval] Running Suite 3 — First-Email Writing & Anti-Hallucination Grounding (10 qualified leads)...\n"
			);
			const res = await runEmailsEvalSuite({ rpm: cli.rpm });
			suites.push(res);
			process.stdout.write(
				`[Eval] Suite 3 complete: ${res.passedCases}/${res.totalCases} (${res.passRatePct.toFixed(1)}%), avg=${res.latency.avgMs}ms, p95=${res.latency.p95Ms}ms\n`
			);
		}

		if (cli.suite === "all" || cli.suite === "replies") {
			process.stdout.write(
				"[Eval] Running Suite 4 — Inbound Replies, Guardrails & Calendar Booking (30 test replies)...\n"
			);
			const res = await runRepliesEvalSuite({
				dbContext,
				rpm: cli.rpm,
			});
			suites.push(res);
			process.stdout.write(
				`[Eval] Suite 4 complete: ${res.passedCases}/${res.totalCases} (${res.passRatePct.toFixed(1)}%), avg=${res.latency.avgMs}ms, p95=${res.latency.p95Ms}ms\n`
			);
		}
	} finally {
		configureExaTelemetry(null);
		configureSdrLlmExecution(null);
		cleanupStats = await dbContext.cleanup();
		await closeEvalDb();
	}

	const overallTotalCases = suites.reduce((sum, s) => sum + s.totalCases, 0);
	const overallPassedCases = suites.reduce((sum, s) => sum + s.passedCases, 0);
	const overallPassRatePct =
		overallTotalCases > 0
			? Number(((overallPassedCases / overallTotalCases) * 100).toFixed(1))
			: 0;
	const failures = suites.flatMap((s) => s.failures);

	const report: FullEvaluationReport = {
		cliOptions: {
			fallbackChain: [...GEMINI_FALLBACK_MODELS],
			rpm: cli.rpm,
			suite: cli.suite,
		},
		dbIsolation: {
			afterCompanyCount: cleanupStats.after.companyCount,
			afterThreadCount: cleanupStats.after.threadCount,
			beforeCompanyCount: cleanupStats.before.companyCount,
			beforeThreadCount: cleanupStats.before.threadCount,
			isolatedOrgCleanedUp: cleanupStats.isolatedOrgCleanedUp,
			liveDemoDataUnchanged: cleanupStats.liveDemoDataUnchanged,
		},
		failures,
		generatedAt: new Date().toISOString(),
		overallPassedCases,
		overallPassRatePct,
		overallTotalCases,
		suites,
		unitEconomics: computeUnitEconomicsSummary(suites),
	};

	const markdown = renderMarkdownEvaluationReport(report);
	const resultsDir = resolve(process.cwd(), "evals/results");
	await mkdir(resultsDir, { recursive: true });
	const jsonPath = resolve(resultsDir, "latest.json");
	const mdPath = resolve(resultsDir, "latest.md");

	await writeFile(jsonPath, `${JSON.stringify(report, null, "\t")}\n`, "utf8");
	await writeFile(mdPath, `${markdown}\n`, "utf8");

	process.stdout.write(
		`\n[Eval] Saved results to ${jsonPath} and ${mdPath}\n\n`
	);
	process.stdout.write(`${markdown}\n`);

	if (failures.length > 0 || !cleanupStats.liveDemoDataUnchanged) {
		process.exit(1);
	}
}

async function runCli(): Promise<void> {
	try {
		await main();
	} catch (error) {
		try {
			await closeEvalDb();
		} catch {
			// Ignore close error during fatal exit
		}
		process.stderr.write(
			`[Eval] Fatal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
		);
		process.exit(1);
	}
}

runCli();
