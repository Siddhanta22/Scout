import { Router } from "express";
import { einSchema } from "../ein.js";
import { asyncHandler } from "../errors.js";
import type { OrgService } from "../orgService.js";

export function organizationsRouter(orgs: OrgService) {
  const router = Router();

  router.get(
    "/organizations/:ein",
    asyncHandler(async (req, res) => {
      const ein = einSchema.parse(String(req.params.ein));
      res.json(await orgs.getOrganization(ein));
    }),
  );

  return router;
}
