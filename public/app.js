// Scout dashboard. Vanilla JS; every render goes through h() which uses
// textContent, so org names from upstream data can never inject markup.
const STATUSES = ["New", "Contacted", "In conversation", "Signed", "Passed"];
const $ = (id) => document.getElementById(id);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const money = (n) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);

function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "show" + (isError ? " error" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = ""), 3000);
}

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (auth) {
    const key = $("apiKey").value.trim();
    if (!key) throw new Error("Enter your API key at the top to save or edit prospects.");
    headers["x-api-key"] = key;
  }
  let res;
  try {
    res = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Could not reach the Scout server.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
  return data;
}

// --- API key persistence (browser only) ---
$("apiKey").value = localStorage.getItem("scoutKey") || "";
// Local-only convenience: the server returns the key only when started with
// SCOUT_DEV_PREFILL=true and the request is from this machine. A 404 just
// means "not enabled", so fall back to the manual box silently.
if (!$("apiKey").value) {
  fetch("/api/dev-key")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (d?.apiKey && !$("apiKey").value) $("apiKey").value = d.apiKey;
    })
    .catch(() => {});
}
$("apiKey").addEventListener("change", () => localStorage.setItem("scoutKey", $("apiKey").value.trim()));

// --- tabs ---
function showTab(name) {
  for (const t of ["search", "shortlist"]) {
    $("view-" + t).hidden = t !== name;
    $("tab-" + t).classList.toggle("active", t === name);
  }
  if (name === "shortlist") loadShortlist();
}
$("tab-search").onclick = () => showTab("search");
$("tab-shortlist").onclick = () => showTab("shortlist");

// --- search ---
let lastSearch = null;
let savedEins = new Set();

async function runSearch(page = 0) {
  const params = new URLSearchParams();
  if ($("q").value.trim()) params.set("q", $("q").value.trim());
  if ($("state").value.trim()) params.set("state", $("state").value.trim());
  if ($("cause").value) params.set("cause", $("cause").value);
  if (page) params.set("page", page);
  lastSearch = params;
  const msg = $("searchMsg");
  msg.className = "msg";
  if (![...params.keys()].some((k) => k !== "page")) {
    msg.textContent = "Enter a name, a state, or a cause area.";
    return;
  }
  msg.textContent = "Searching…";
  $("results").replaceChildren();
  $("pager").replaceChildren();
  try {
    const [data, list] = await Promise.all([api("/search?" + params), api("/prospects")]);
    savedEins = new Set(list.prospects.map((p) => p.ein));
    $("count").textContent = list.total;
    msg.textContent = data.total
      ? `${data.total.toLocaleString()} organizations`
      : "No organizations matched.";
    $("results").replaceChildren(...data.results.map(resultCard));
    renderPager(data);
  } catch (e) {
    msg.className = "msg error";
    msg.textContent = e.message;
  }
}

function resultCard(o) {
  const saveBtn = h("button", { class: "primary", disabled: savedEins.has(o.ein) }, savedEins.has(o.ein) ? "Saved" : "Save");
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      await api("/prospects", { method: "POST", body: { ein: o.ein }, auth: true });
      saveBtn.textContent = "Saved";
      savedEins.add(o.ein);
      $("count").textContent = savedEins.size;
      toast(`Saved ${o.name}`);
    } catch (e) {
      saveBtn.disabled = false;
      toast(e.message, true);
    }
  };
  const detail = h("div", { class: "trend", hidden: true });
  const detailBtn = h("button", { onclick: () => toggleDetail(o.ein, detail, detailBtn) }, "Financials");
  return h(
    "div",
    { class: "card" },
    h("div", { class: "row" },
      h("div", {},
        h("div", { class: "name" }, o.name),
        h("div", { class: "meta" }, [o.city, o.state].filter(Boolean).join(", ") || "Location unknown", " · ", o.causeArea || "Cause unknown", " · EIN ", o.ein),
      ),
      h("div", { class: "actions" }, detailBtn, saveBtn),
    ),
    detail,
  );
}

async function toggleDetail(ein, box, btn) {
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(h("div", { class: "meta" }, "Loading financials…"));
  btn.disabled = true;
  try {
    const d = await api("/organizations/" + ein);
    box.replaceChildren(...[trendView(d.filings.slice().reverse()), d.stale && staleNote()].filter(Boolean));
  } catch (e) {
    box.replaceChildren(h("div", { class: "msg error" }, e.message));
  } finally {
    btn.disabled = false;
  }
}

const staleNote = () => h("div", { class: "meta" }, "Showing older cached data; ProPublica is unreachable.");

function renderPager(data) {
  const pager = $("pager");
  if (data.numPages <= 1) return;
  const go = (p) => () => runSearch(p);
  pager.replaceChildren(
    h("button", { disabled: data.page <= 0, onclick: go(data.page - 1) }, "← Prev"),
    h("span", { class: "meta" }, `Page ${data.page + 1} of ${data.numPages}`),
    h("button", { disabled: data.page + 1 >= data.numPages, onclick: go(data.page + 1) }, "Next →"),
  );
}

$("searchForm").addEventListener("submit", (e) => { e.preventDefault(); runSearch(0); });

// --- trend chart: grouped bars of revenue vs expenses per year, inline SVG ---
function trendView(filings) {
  const rows = filings.filter((f) => f.totalRevenue != null || f.totalExpenses != null);
  if (!rows.length) return h("div", { class: "meta" }, "No financial data filed for this organization.");
  const W = 600, H = 140, pad = 24;
  const max = Math.max(...rows.flatMap((f) => [f.totalRevenue || 0, f.totalExpenses || 0])) || 1;
  const slot = (W - pad) / rows.length;
  const bw = Math.min(26, slot / 2.6);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H + 18}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Revenue and expenses by tax year");
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    svg.append(el);
    return el;
  };
  rows.forEach((f, i) => {
    const x = pad + i * slot + slot / 2;
    [[f.totalRevenue, "#1f5c4a", -bw], [f.totalExpenses, "#c98b2b", 0]].forEach(([v, color, dx]) => {
      const bh = ((v || 0) / max) * (H - 14);
      const r = add("rect", { x: x + dx, y: H - bh, width: bw, height: bh, fill: color });
      r.append(Object.assign(document.createElementNS(ns, "title"), { textContent: `${f.taxYear}: ${money(v)}` }));
    });
    add("text", { x, y: H + 13, "text-anchor": "middle", "font-size": 11, fill: "#5c6b78" }, f.taxYear);
  });
  add("text", { x: 0, y: 10, "font-size": 10, fill: "#5c6b78" }, money(max));
  return h("div", {}, svg,
    h("div", { class: "legend" },
      h("span", {}, h("i", { style: "background:#1f5c4a" }), "Revenue"),
      h("span", {}, h("i", { style: "background:#c98b2b" }), "Expenses")));
}

// --- shortlist ---
async function loadShortlist() {
  const p = new URLSearchParams();
  if ($("fStatus").value) p.set("status", $("fStatus").value);
  if ($("fState").value.trim()) p.set("state", $("fState").value.trim());
  if ($("fCause").value) p.set("cause", $("fCause").value);
  p.set("sort", $("fSort").value);
  // Export exactly what the filters are showing.
  $("exportLink").href = "/api/prospects/export.csv?" + p;
  const msg = $("shortlistMsg");
  msg.className = "msg";
  try {
    const data = await api("/prospects?" + p);
    $("count").textContent = data.total;
    msg.textContent = data.total ? "" : "Nothing on the shortlist matches. Search for nonprofits and save some.";
    $("prospects").replaceChildren(...data.prospects.map(prospectCard));
  } catch (e) {
    msg.className = "msg error";
    msg.textContent = e.message;
  }
}

function prospectCard(p) {
  const badge = h("span", { class: "badge s-" + p.status.replace(/ /g, "-") }, p.status);
  const select = h("select", {}, STATUSES.map((s) => h("option", { value: s, selected: s === p.status }, s)));
  const notes = h("textarea", { placeholder: "Notes (contacts, next steps…)" });
  notes.value = p.notes;
  const saveBtn = h("button", {}, "Save changes");
  const trend = h("div", { class: "trend", hidden: true });
  const why = h("div", { class: "why", hidden: true },
    h("ul", {}, p.fit.reasons.map((r) =>
      h("li", {},
        h("span", { class: "pts " + (r.points === r.max ? "full" : r.points === 0 ? "zero" : "") }, `${r.points}/${r.max}`),
        h("span", {}, r.text)))));
  const fitBadge = h("span", { class: "fit f-" + p.fit.label.replace(/ /g, "-"), title: "Score " + p.fit.score + "/100" }, p.fit.label, " · ", p.fit.score);
  const whyBtn = h("button", { onclick: () => (why.hidden = !why.hidden) }, "Why this fit?");

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      const u = await api("/prospects/" + p.id, { method: "PATCH", body: { status: select.value, notes: notes.value }, auth: true });
      badge.className = "badge s-" + u.status.replace(/ /g, "-");
      badge.textContent = u.status;
      toast("Saved");
    } catch (e) {
      toast(e.message, true);
    } finally {
      saveBtn.disabled = false;
    }
  };
  const trendBtn = h("button", {}, "Trend");
  trendBtn.onclick = async () => {
    if (!trend.hidden) { trend.hidden = true; return; }
    trend.hidden = false;
    trend.replaceChildren(h("div", { class: "meta" }, "Loading…"));
    try {
      const d = await api(`/prospects/${p.id}/history`);
      trend.replaceChildren(...[trendView(d.history), d.stale && staleNote()].filter(Boolean));
    } catch (e) {
      trend.replaceChildren(h("div", { class: "msg error" }, e.message));
    }
  };
  const del = h("button", { class: "danger" }, "Remove");
  del.onclick = async () => {
    if (!confirm(`Remove ${p.name} from the shortlist?`)) return;
    try {
      await api("/prospects/" + p.id, { method: "DELETE", auth: true });
      loadShortlist();
    } catch (e) {
      toast(e.message, true);
    }
  };

  return h("div", { class: "card" },
    h("div", { class: "row" },
      h("div", {},
        h("div", { class: "name" }, p.name, " ", badge, " ", fitBadge),
        h("div", { class: "meta" }, [p.city, p.state].filter(Boolean).join(", ") || "Location unknown", " · ", p.causeArea || "Cause unknown", " · EIN ", p.ein)),
      h("div", { class: "nums" }, h("div", {}, `Revenue${p.latestTaxYear ? " (" + p.latestTaxYear + ")" : ""}`, h("b", {}, money(p.latestRevenue))))),
    notes,
    h("div", { class: "actions" }, select, saveBtn, whyBtn, trendBtn, del),
    why,
    trend);
}

for (const id of ["fStatus", "fState", "fCause", "fSort"]) $(id).addEventListener("change", loadShortlist);

// --- bootstrap filter options ---
(async function init() {
  for (const s of STATUSES) $("fStatus").append(h("option", { value: s }, s));
  try {
    const { causes } = await api("/causes");
    for (const c of causes) {
      $("cause").append(h("option", { value: c.id }, c.name));
      $("fCause").append(h("option", { value: c.name }, c.name));
    }
    const list = await api("/prospects");
    $("count").textContent = list.total;
    const f = await api("/fit/criteria");
    const money = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
    $("fitCriteria").textContent =
      `Fit scoring: revenue ${money(f.minRevenue)}–${money(f.maxRevenue)} · ` +
      (f.targetCauses.length ? `causes: ${f.targetCauses.join(", ")}` : "any cause") +
      " · change in .env (FIT_MIN_REVENUE, FIT_MAX_REVENUE, FIT_TARGET_CAUSES)";
  } catch (e) {
    $("searchMsg").className = "msg error";
    $("searchMsg").textContent = e.message;
  }
})();
