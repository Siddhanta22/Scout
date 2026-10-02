# Scout

A nonprofit-prospecting tool for student consulting groups. Search the public IRS Form 990 dataset (via [ProPublica's Nonprofit Explorer API](https://projects.propublica.org/nonprofits/api), free, no key), shortlist organizations worth contacting, and track outreach status and notes.

Stack: TypeScript, Express 5, Prisma + SQLite, Vitest + Supertest, vanilla HTML/CSS/JS dashboard.

## Quick start (about 2 minutes)

Requires Node 20+.

```bash
git clone https://github.com/Siddhanta22/Scout.git && cd Scout
npm install
cp .env.example .env        # then set SCOUT_API_KEY to something secret
npx prisma migrate deploy   # creates dev.db
npm run dev                 # http://localhost:3000
```

Open http://localhost:3000. Paste your `SCOUT_API_KEY` into the key box at the top (stored in your browser only) to save or edit prospects. Searching and browsing need no key.

Production: `npm run build && npm start`.

### Environment variables

| Name | Required | Default | Purpose |
|---|---|---|---|
| `SCOUT_API_KEY` | yes | none | Shared secret for write endpoints (`X-API-Key` header). The server refuses to start without it. |
| `DATABASE_URL` | yes | `file:./dev.db` (in `.env.example`) | SQLite file. Relative paths resolve from `prisma/`. |
| `PORT` | no | `3000` | HTTP port. |
| `FILING_TTL_DAYS` | no | `30` | How long cached filings are served before refetching. |
| `PROPUBLICA_BASE_URL` | no | ProPublica v2 API | Override for testing. |

### Scripts

`npm run dev` (watch mode), `npm test`, `npm run typecheck`, `npm run build`, `npm start`.

## Where the data comes from

All organization and financial data is public IRS Form 990 data, served by ProPublica's [Nonprofit Explorer API](https://projects.propublica.org/nonprofits/api) (underlying sources: the IRS Exempt Organizations Business Master File and the IRS Statistics of Income annual extract). Scout does not alter it. Figures are as filed, and the most recent filings often lag by 1-2 years. Some organizations (churches, very small orgs) file no 990 and have no financials.

## API

JSON under `/api`. Errors are always `{ "error": { "code", "message", "details?" } }`. Writes need `X-API-Key`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/search?q=&state=&cause=&page=` | no | Proxy ProPublica search. `state` is a 2-letter code, `cause` is an NTEE major group id 1-10 (see `/api/causes`), `page` is 0-indexed. Needs at least one of q/state/cause. Returns a trimmed list and no financials. |
| GET | `/api/causes` | no | Cause-area ids and names. |
| GET | `/api/organizations/:ein` | no | Org plus all filing years. Cache-first (see below). EIN may be `53-0196605` or `530196605`. |
| POST | `/api/prospects` | yes | `{ein, notes?}`. Saves with status `New`. 409 if already saved. |
| GET | `/api/prospects?status=&state=&cause=&sort=` | no | `cause` is the cause-area name (e.g. `Human Services`). `sort` is `-savedAt` (default), `revenue`, `-revenue` or `name`. Prospects without revenue data sort last. |
| GET | `/api/prospects/export.csv` | no | Same filters and sort as the list, downloaded as `scout-shortlist.csv`. Opens cleanly in Excel/Sheets (UTF-8 BOM). Cells beginning with `= + - @` are prefixed with `'` so notes can't run as spreadsheet formulas. |
| PATCH | `/api/prospects/:id` | yes | `{status?, notes?, website?}`. |
| GET | `/api/prospects/:id/history` | no | Revenue/expense/asset trend, oldest to newest. |
| DELETE | `/api/prospects/:id` | yes | 204. |

Statuses: `New`, `Contacted`, `In conversation`, `Signed`, `Passed`. Any status can move to any other, because a person decides.

## Design decisions

**Caching.** `GET /organizations/:ein` and `GET /prospects/:id/history` go through one service. Within `FILING_TTL_DAYS` of the last fetch, ProPublica is not called (tested by counting upstream calls with a fake clock). After the TTL it refetches and replaces that EIN's rows in a single transaction. If the refresh fails but we hold older data, we serve it with `stale: true` instead of erroring. Search results are not cached, since they're cheap and query-shaped.

**Being polite to ProPublica.** One client serializes requests with a 250 ms minimum gap, times out after 10 s, and retries 429/5xx up to twice with exponential backoff (honouring `Retry-After`). Failures map to `502 UPSTREAM_ERROR`, `503 UPSTREAM_RATE_LIMITED` or `504 UPSTREAM_TIMEOUT`.

**Messy upstream data.** `ein` arrives as a number (leading zeros are restored), `ntee_code` is frequently null, and filings sometimes omit money fields or repeat a tax year (amended returns). The client coerces defensively: money fields are nullable, and one row is kept per year.

**Deviation from the brief: an `Organization` table.** The brief names two entities. I added a small third (`Organization`: ein, name, city, state, nteeCode, fetchedAt) because (a) the cache TTL needs an anchor even for orgs with zero filings, otherwise they'd be refetched on every request, and (b) a cache hit needs the org name without another upstream call. `Prospect` still copies its own descriptive fields at save time, so it stands alone.

**Money as `Float`.** Large nonprofits report revenue past 2^31, which overflows Prisma's SQLite `Int`. `Float` is exact for integers up to 2^53.

**Status is a validated string,** not a DB enum, because SQLite has no enums. Validation happens at the API edge.

**Auth** is one shared key compared in constant time. Reads are public by design (the data is public). A real login system would be over-engineering for a small internal team tool.

**Dashboard safety.** Org names come from an external source, so the frontend builds DOM with `textContent` only (never `innerHTML`).

## Testing

`npm test` runs 28 tests against a throwaway SQLite file (`prisma/test.db`, real migrations applied):

- Unit: cache hit within TTL, refetch after TTL, stale-on-error, unknown EIN not cached.
- Client: param mapping, missing fields, de-duplicated years, 404, 429 with `Retry-After`, backoff, timeout and bad JSON mapping.
- Integration: search, save, update status, list, history, delete end to end. CSV export, with quoting and formula-injection cases. Also auth on every write route, consistent errors, validation, duplicates, filters and sorting.

Tests use a fake ProPublica client, so they're fast and don't hit the network.

## Known limitations / what I'd do next

- **Stretch goals not built:** geocoding/map, fit score, outreach drafts (CSV export is done). I prioritized a solid, tested core.
- **Search is not cached.** Fine at club scale. A short in-memory TTL cache would cut repeat queries.
- **Shortlist sort/filter by revenue happens in memory** after one DB query per prospect for the latest revenue. That's fine for hundreds of prospects, but would want a join or denormalized column beyond that.
- **Stale data isn't refreshed in the background.** The cache refreshes lazily on the next request after the TTL.
- **Prospect `website` isn't populated.** ProPublica's API doesn't expose it, so it's a manual field via `PATCH`, and the dashboard doesn't edit it yet.
- **Single shared key means no per-user audit trail.** Anyone with the key can edit anything.
- **SQLite file is single-writer.** Fine for a small team. The Prisma schema ports to Postgres by changing the provider and datasource.
- **The API key sits in browser `localStorage`.** Acceptable for a small trusted team, but not for a public deployment.
