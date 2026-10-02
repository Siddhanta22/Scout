import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../errors.js";
import { CAUSE_AREAS, causeAreaFor } from "../ntee.js";
import type { PropublicaClient } from "../propublica.js";

const query = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
    state: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, "state must be a 2-letter code")
      .transform((s) => s.toUpperCase())
      .optional(),
    // NTEE major group id (1-10); see GET /search?cause=5
    cause: z.coerce.number().int().min(1).max(10).optional(),
    page: z.coerce.number().int().min(0).max(1000).default(0),
  })
  .refine((v) => v.q || v.state || v.cause, {
    message: "Provide at least one of q, state, or cause",
  });

export function searchRouter(client: PropublicaClient) {
  const router = Router();

  router.get("/causes", (_req, res) => {
    res.json({
      causes: Object.entries(CAUSE_AREAS).map(([id, name]) => ({ id: Number(id), name })),
    });
  });

  router.get(
    "/search",
    asyncHandler(async (req, res) => {
      const { q, state, cause, page } = query.parse(req.query);
      const result = await client.search({ q, state, ntee: cause, page });
      res.json({
        total: result.total,
        page: result.page,
        numPages: result.numPages,
        results: result.results.map((o) => ({ ...o, causeArea: causeAreaFor(o.nteeCode) })),
      });
    }),
  );

  return router;
}
