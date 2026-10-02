import { Router } from "express";
import { z } from "zod";
import { requireApiKey } from "../auth.js";
import type { Db } from "../db.js";
import { einSchema } from "../ein.js";
import { AppError, asyncHandler } from "../errors.js";
import { prospectsToCsv } from "../csv.js";
import { scoreFit, type FitConfig } from "../fit.js";
import type { OrgService } from "../orgService.js";

export const STATUSES = ["New", "Contacted", "In conversation", "Signed", "Passed"] as const;
const status = z.enum(STATUSES);

const createBody = z.object({
  ein: einSchema,
  notes: z.string().max(5000).optional(),
});

const patchBody = z
  .object({
    status: status.optional(),
    notes: z.string().max(5000).optional(),
    website: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Provide status, notes, or website" });

const listQuery = z.object({
  status: status.optional(),
  state: z
    .string()
    .trim()
    .length(2)
    .transform((s) => s.toUpperCase())
    .optional(),
  cause: z.string().trim().min(1).optional(),
  sort: z.enum(["revenue", "-revenue", "name", "-savedAt", "-fit"]).default("-savedAt"),
});

type ProspectRow = NonNullable<Awaited<ReturnType<Db["prospect"]["findUnique"]>>>;

interface RevenueYear {
  taxYear: number;
  totalRevenue: number;
}

function present(p: ProspectRow, revenues: RevenueYear[], fitCfg: FitConfig) {
  const latest = revenues[0];
  return {
    id: p.id,
    ein: p.ein,
    name: p.name,
    city: p.city,
    state: p.state,
    nteeCode: p.nteeCode,
    causeArea: p.causeArea,
    website: p.website,
    status: p.status,
    notes: p.notes,
    savedAt: p.savedAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    latestTaxYear: latest?.taxYear ?? null,
    latestRevenue: latest?.totalRevenue ?? null,
    fit: scoreFit({ causeArea: p.causeArea, revenues }, fitCfg),
  };
}

export function prospectsRouter(db: Db, orgs: OrgService, apiKey: string, fitCfg: FitConfig) {
  const router = Router();
  const auth = requireApiKey(apiKey);

  async function findOr404(id: string) {
    const p = await db.prospect.findUnique({ where: { id } });
    if (!p) throw new AppError(404, "PROSPECT_NOT_FOUND", `No prospect ${id}`);
    return p;
  }

  // Years that report revenue, newest first, for each EIN. One query for the
  // whole list; the fit trend needs the two most recent years.
  async function revenueByEin(eins: string[]): Promise<Map<string, RevenueYear[]>> {
    const rows = await db.filingSnapshot.findMany({
      where: { ein: { in: eins }, totalRevenue: { not: null } },
      orderBy: { taxYear: "desc" },
      select: { ein: true, taxYear: true, totalRevenue: true },
    });
    const map = new Map<string, RevenueYear[]>();
    for (const r of rows) {
      const list = map.get(r.ein) ?? [];
      list.push({ taxYear: r.taxYear, totalRevenue: r.totalRevenue as number });
      map.set(r.ein, list);
    }
    return map;
  }

  async function presentOne(p: ProspectRow) {
    return present(p, (await revenueByEin([p.ein])).get(p.ein) ?? [], fitCfg);
  }

  // The settings behind every fit score, so the UI can show what "fit" means.
  router.get("/fit/criteria", (_req, res) => {
    res.json(fitCfg);
  });

  router.post(
    "/prospects",
    auth,
    asyncHandler(async (req, res) => {
      const { ein, notes } = createBody.parse(req.body);
      if (await db.prospect.findUnique({ where: { ein } })) {
        throw new AppError(409, "ALREADY_SAVED", `EIN ${ein} is already on the shortlist`);
      }
      const { organization: o } = await orgs.getOrganization(ein);
      const created = await db.prospect.create({
        data: {
          ein,
          name: o.name,
          city: o.city,
          state: o.state,
          nteeCode: o.nteeCode,
          causeArea: o.causeArea,
          notes: notes ?? "",
        },
      });
      res.status(201).json(await presentOne(created));
    }),
  );

  async function listProspects(query: unknown) {
    const q = listQuery.parse(query);
    const rows = await db.prospect.findMany({
      where: {
        ...(q.status && { status: q.status }),
        ...(q.state && { state: q.state }),
        // exact match against the derived cause area name (e.g. "Human Services")
        ...(q.cause && { causeArea: { equals: q.cause } }),
      },
    });
    const revenues = await revenueByEin(rows.map((p) => p.ein));
    const items = rows.map((p) => present(p, revenues.get(p.ein) ?? [], fitCfg));
    items.sort((a, b) => {
      switch (q.sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "-savedAt":
          return b.savedAt.localeCompare(a.savedAt);
        case "-fit":
          return b.fit.score - a.fit.score || a.name.localeCompare(b.name);
        default: {
          // Prospects without revenue data always sort last.
          const dir = q.sort === "revenue" ? 1 : -1;
          if (a.latestRevenue === null && b.latestRevenue === null) return 0;
          if (a.latestRevenue === null) return 1;
          if (b.latestRevenue === null) return -1;
          return dir * (a.latestRevenue - b.latestRevenue);
        }
      }
    });
    return items;
  }

  router.get(
    "/prospects",
    asyncHandler(async (req, res) => {
      const items = await listProspects(req.query);
      res.json({ total: items.length, prospects: items });
    }),
  );

  // Same filters and sort as the list, so "export what I'm looking at" works.
  router.get(
    "/prospects/export.csv",
    asyncHandler(async (req, res) => {
      const items = await listProspects(req.query);
      res
        .type("text/csv; charset=utf-8")
        .set("Content-Disposition", 'attachment; filename="scout-shortlist.csv"')
        .send(prospectsToCsv(items));
    }),
  );

  router.patch(
    "/prospects/:id",
    auth,
    asyncHandler(async (req, res) => {
      const body = patchBody.parse(req.body);
      const existing = await findOr404(String(req.params.id));
      const updated = await db.prospect.update({
        where: { id: existing.id },
        data: {
          ...(body.status !== undefined && { status: body.status }),
          ...(body.notes !== undefined && { notes: body.notes }),
          ...(body.website !== undefined && { website: body.website || null }),
        },
      });
      res.json(await presentOne(updated));
    }),
  );

  router.get(
    "/prospects/:id/history",
    asyncHandler(async (req, res) => {
      const p = await findOr404(String(req.params.id));
      const { filings, cached, stale } = await orgs.getOrganization(p.ein);
      res.json({
        prospectId: p.id,
        ein: p.ein,
        name: p.name,
        cached,
        stale,
        // oldest -> newest, so it charts left to right
        history: [...filings].sort((a, b) => a.taxYear - b.taxYear),
      });
    }),
  );

  router.delete(
    "/prospects/:id",
    auth,
    asyncHandler(async (req, res) => {
      const p = await findOr404(String(req.params.id));
      await db.prospect.delete({ where: { id: p.id } });
      res.status(204).end();
    }),
  );

  return router;
}
