import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { createOrgService } from "./orgService.js";
import type { PropublicaClient } from "./propublica.js";
import { organizationsRouter } from "./routes/organizations.js";
import { prospectsRouter } from "./routes/prospects.js";
import { searchRouter } from "./routes/search.js";

export interface AppDeps {
  config: Config;
  db: Db;
  client: PropublicaClient;
  now?: () => Date;
}

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

export function createApp({ config, db, client, now }: AppDeps) {
  const app = express();
  app.use(express.json({ limit: "50kb" }));

  const orgs = createOrgService({ db, client, ttlMs: config.filingTtlMs, now });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // JSON API lives under /api; the dashboard is static files at /.
  const api = express.Router();
  api.use(searchRouter(client));
  api.use(organizationsRouter(orgs));
  api.use(prospectsRouter(db, orgs, config.apiKey));
  api.use(notFoundHandler);
  app.use("/api", api);

  app.use(express.static(publicDir));
  app.use(errorHandler);

  return app;
}
