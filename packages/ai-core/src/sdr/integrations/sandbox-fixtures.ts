export interface RawSourceDocument {
	fetchedAt: string;
	sourceType: "exa" | "website" | "shopify_probe" | "ats" | "press" | "curated";
	text: string;
	title: string;
	url: string;
}

export interface DiscoveredProspectCandidate {
	channels: string[];
	contactEmail?: string;
	contactFirstName?: string;
	contactLastName?: string;
	contactRole?: string;
	domain: string;
	location?: string;
	name: string;
	seedDocuments?: RawSourceDocument[];
}

export const CURATED_US_ECOMMERCE_PROSPECTS: DiscoveredProspectCandidate[] = [
	{
		channels: ["shopify", "amazon", "wholesale"],
		contactEmail: "hannah@canyongoods.com",
		contactFirstName: "Hannah",
		contactLastName: "Brooks",
		contactRole: "Head of Finance",
		domain: "canyongoods.com",
		location: "Austin, TX",
		name: "Canyon Goods Co",
		seedDocuments: [
			{
				fetchedAt: "2026-11-12T10:00:00.000Z",
				sourceType: "website",
				text: "Canyon Goods Co builds durable outdoor drinkware and camp gear from our Austin, Texas headquarters. We ship DTC across the United States via Shopify Plus, fulfill Prime orders on Amazon, and supply 65 specialty retailers nationwide.",
				title: "About Canyon Goods Co | Austin, TX",
				url: "https://canyongoods.com/pages/about",
			},
			{
				fetchedAt: "2026-11-12T10:00:00.000Z",
				sourceType: "ats",
				text: "Hiring Senior Ecommerce Accountant in Austin, TX to reconcile high-volume Shopify payouts, Amazon FBA settlements, landed inventory COGS, and multi-state sales tax across our 3PL warehouses.",
				title: "Senior Ecommerce Accountant / Controller - Canyon Goods Co",
				url: "https://boards.greenhouse.io/canyongoods/jobs/48102",
			},
		],
	},
	{
		channels: ["shopify", "amazon"],
		contactEmail: "devon@loomandtide.com",
		contactFirstName: "Devon",
		contactLastName: "Mercer",
		contactRole: "Founder & CEO",
		domain: "loomandtide.com",
		location: "Charleston, SC",
		name: "Loom & Tide Home",
		seedDocuments: [
			{
				fetchedAt: "2026-11-12T10:05:00.000Z",
				sourceType: "website",
				text: "Founded in Charleston, South Carolina, Loom & Tide crafts organic bath linens for US households. After expanding onto Amazon FBA earlier this year alongside our flagship Shopify storefront, our team grew to 22 people.",
				title: "Our Story | Loom & Tide Home",
				url: "https://loomandtide.com/pages/our-story",
			},
			{
				fetchedAt: "2026-11-12T10:05:00.000Z",
				sourceType: "press",
				text: "Charleston-based Loom & Tide closed a $3.2M seed round in October 2026 to deepen inventory across Shopify DTC and new Amazon storefront bundles.",
				title: "Loom & Tide raises $3.2M Seed to scale retail & Amazon",
				url: "https://techcrunch.example.com/loom-and-tide-seed",
			},
		],
	},
	{
		channels: ["shopify", "wholesale"],
		contactEmail: "nora@kestrelroasters.com",
		contactFirstName: "Nora",
		contactLastName: "Alvarez",
		contactRole: "VP of Operations & Finance",
		domain: "kestrelroasters.com",
		location: "Portland, OR",
		name: "Kestrel Roasters",
		seedDocuments: [
			{
				fetchedAt: "2026-11-12T10:10:00.000Z",
				sourceType: "website",
				text: "Roasted daily in Portland, Oregon. Kestrel Roasters runs recurring Shopify Subscriptions alongside wholesale grocery distribution across the Pacific Northwest with an 18-person roastery and ops team.",
				title: "Portland Roastery | Kestrel Roasters",
				url: "https://kestrelroasters.com/pages/roastery",
			},
			{
				fetchedAt: "2026-11-12T10:10:00.000Z",
				sourceType: "ats",
				text: "Seeking a Finance & Inventory Ops Manager to own green-bean COGS tracking, Shopify subscription deferred revenue, and monthly close on NetSuite/QuickBooks.",
				title: "Finance & Inventory Ops Manager — Portland, OR",
				url: "https://jobs.ashbyhq.com/kestrel-roasters/finance-manager",
			},
		],
	},
	{
		channels: ["shopify", "amazon", "retail"],
		contactEmail: "trevor@harborviewpets.com",
		contactFirstName: "Trevor",
		contactLastName: "Kim",
		contactRole: "CFO / Controller",
		domain: "harborviewpets.com",
		location: "Denver, CO",
		name: "Harborview Pet Nutrition",
		seedDocuments: [
			{
				fetchedAt: "2026-11-12T10:15:00.000Z",
				sourceType: "website",
				text: "Harborview Pet Nutrition formulates vet-backed canine supplements in Denver, Colorado. We launched in 140 regional pet boutiques this quarter alongside Amazon Subscribe & Save and our Shopify store.",
				title: "About Harborview Pet Nutrition | Denver, CO",
				url: "https://harborviewpets.com/pages/about-us",
			},
			{
				fetchedAt: "2026-11-12T10:15:00.000Z",
				sourceType: "ats",
				text: "Own monthly close across Shopify Payments, Stripe, Amazon seller payouts, 3PL inventory counts, and wholesale retail chargebacks.",
				title: "Accounting & Reconciliation Lead — Harborview Pet Nutrition",
				url: "https://jobs.lever.co/harborviewpets/accounting-lead",
			},
		],
	},
	{
		channels: ["shopify", "tiktok_shop"],
		contactEmail: "claire@briarwoodskin.com",
		contactFirstName: "claire",
		contactLastName: "Patel",
		contactRole: "Co-Founder & COO",
		domain: "briarwoodskin.com",
		location: "Nashville, TN",
		name: "Briarwood Skincare",
		seedDocuments: [
			{
				fetchedAt: "2026-11-12T10:20:00.000Z",
				sourceType: "website",
				text: "Headquartered in Nashville, TN, Briarwood Skincare ships botanical body care direct to US customers on Shopify and recently expanded to TikTok Shop fulfillment across two US warehouses.",
				title: "Briarwood Skincare | Nashville, Tennessee",
				url: "https://briarwoodskin.com/pages/company",
			},
		],
	},
];
