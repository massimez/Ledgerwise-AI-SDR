import {
	createRouter,
	createSuccessResponse,
	jsonValidator,
	paramValidator,
	queryValidator,
} from "../../../lib/create-hono-app";
import { getActiveOrgContext } from "../../../lib/tenant";
import { hasOrgPermission } from "../../../middleware/org-permission";
import {
	companyIdParamSchema,
	importCompanyUrlSchema,
	listCompaniesQuerySchema,
	updateCompanySchema,
} from "../schema";
import {
	getCompanyDetail,
	importCompanyUrl,
	listCompanies,
	updateCompanyQualification,
} from "./companies.service";

export const companiesRoutes = createRouter()
	.get(
		"/",
		hasOrgPermission("lead:read"),
		queryValidator(listCompaniesQuerySchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const query = c.req.valid("query");
			const items = await listCompanies(organizationId, query);
			return c.json(createSuccessResponse({ companies: items }));
		}
	)
	.post(
		"/import",
		hasOrgPermission("lead:research"),
		jsonValidator(importCompanyUrlSchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const input = c.req.valid("json");
			const result = await importCompanyUrl(organizationId, input);
			return c.json(createSuccessResponse(result), 201);
		}
	)
	.get(
		"/:id",
		hasOrgPermission("lead:read"),
		paramValidator(companyIdParamSchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const detail = await getCompanyDetail(organizationId, id);
			return c.json(createSuccessResponse(detail));
		}
	)
	.patch(
		"/:id",
		hasOrgPermission("lead:qualify"),
		paramValidator(companyIdParamSchema),
		jsonValidator(updateCompanySchema),
		async (c) => {
			const { organizationId } = getActiveOrgContext(c);
			const { id } = c.req.valid("param");
			const input = c.req.valid("json");
			const updated = await updateCompanyQualification(
				organizationId,
				id,
				input
			);
			return c.json(createSuccessResponse(updated));
		}
	);
