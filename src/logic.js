"use strict";
// Count Variance Lint: core logic. Pure functions, no DOM, no fetch.

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim() !== ""));
}

function findCol(header, names) {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n);
    if (i >= 0) return i;
  }
  for (let i = 0; i < lower.length; i++) {
    if (names.some((n) => lower[i].includes(n))) return i;
  }
  return -1;
}

// Parse a stock CSV into keyed rows: { sku, location, qty, cost }.
// qtyNames/costNames let system and counted files use different headers.
function parseStockCSV(text, opts) {
  const o = opts || {};
  const rows = parseCSV(text);
  if (!rows.length) return { items: [], warnings: ["CSV is empty"], duplicates: [] };
  const header = rows[0];
  const skuIdx = findCol(header, ["sku", "item", "product", "code"]);
  const locIdx = findCol(header, ["location", "bin", "warehouse", "site"]);
  const qtyIdx = findCol(header, o.qtyNames || ["qty", "quantity", "count", "on hand", "stock"]);
  const costIdx = findCol(header, o.costNames || ["unit cost", "cost", "price", "unit price"]);
  if (skuIdx < 0 || qtyIdx < 0) return { items: [], warnings: ["Could not find SKU and quantity columns"], duplicates: [] };
  const items = [];
  const warnings = [];
  const seen = {};
  const duplicates = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sku = (r[skuIdx] || "").trim();
    if (!sku) continue;
    const location = locIdx >= 0 ? (r[locIdx] || "").trim() : "";
    const qty = Number(r[qtyIdx]);
    if (isNaN(qty)) { warnings.push("Row " + (i + 1) + " (" + sku + "): quantity is not a number, skipped"); continue; }
    const cost = costIdx >= 0 ? Number(r[costIdx]) || 0 : 0;
    const key = sku + " @ " + location;
    if (seen[key]) duplicates.push(key);
    seen[key] = true;
    items.push({ sku, location, qty, cost, key });
  }
  return { items, warnings, duplicates };
}

// Parse a single combined CSV with both system and counted quantity columns.
function parseCombinedCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { system: null, counted: null, error: "CSV is empty" };
  const header = rows[0];
  const sysIdx = findCol(header, ["system qty", "system", "book qty", "expected"]);
  const cntIdx = findCol(header, ["counted qty", "counted", "actual qty", "actual"]);
  if (sysIdx < 0 || cntIdx < 0) return { system: null, counted: null, error: "Combined CSV needs a system quantity column and a counted quantity column" };
  const skuIdx = findCol(header, ["sku", "item", "product", "code"]);
  const locIdx = findCol(header, ["location", "bin", "warehouse", "site"]);
  const costIdx = findCol(header, ["unit cost", "cost", "price", "unit price"]);
  const system = [], counted = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const sku = (r[skuIdx] || "").trim();
    if (!sku) continue;
    const location = locIdx >= 0 ? (r[locIdx] || "").trim() : "";
    const cost = costIdx >= 0 ? Number(r[costIdx]) || 0 : 0;
    const key = sku + " @ " + location;
    const sq = Number(r[sysIdx]); const cq = Number(r[cntIdx]);
    if (!isNaN(sq)) system.push({ sku, location, qty: sq, cost, key });
    if (!isNaN(cq)) counted.push({ sku, location, qty: cq, cost, key });
  }
  return { system: { items: system, warnings: [], duplicates: [] }, counted: { items: counted, warnings: [], duplicates: [] }, error: null };
}

// Compare system vs counted item lists on the composite key.
// Cost falls back: counted cost, else system cost, else 0.
function compareCounts(systemItems, countedItems) {
  const sysMap = new Map(), cntMap = new Map();
  systemItems.forEach((it) => sysMap.set(it.key, it));
  countedItems.forEach((it) => cntMap.set(it.key, it));
  const keys = new Set([...sysMap.keys(), ...cntMap.keys()]);
  const lines = [];
  keys.forEach((key) => {
    const s = sysMap.get(key);
    const c = cntMap.get(key);
    const systemQty = s ? s.qty : 0;
    const countedQty = c ? c.qty : 0;
    const cost = (c && c.cost) || (s && s.cost) || 0;
    const varianceUnits = countedQty - systemQty;
    const varianceValue = Math.round(varianceUnits * cost * 100) / 100;
    const variancePct = systemQty !== 0 ? Math.round((varianceUnits / Math.abs(systemQty)) * 1000) / 10 : (countedQty !== 0 ? 100 : 0);
    lines.push({
      sku: (c || s).sku, location: (c || s).location, key,
      systemQty, countedQty, varianceUnits, varianceValue, variancePct, unitCost: cost,
      missingInCount: !c, missingInSystem: !s
    });
  });
  return lines;
}

// Rank by absolute value impact, biggest first.
function rankByImpact(lines) {
  return lines.slice().sort((a, b) => Math.abs(b.varianceValue) - Math.abs(a.varianceValue) || Math.abs(b.varianceUnits) - Math.abs(a.varianceUnits));
}

// Flag lines breaching a percent threshold or an absolute value threshold.
function flagLines(lines, opts) {
  const o = opts || {};
  const pctLimit = o.pctLimit == null ? 5 : o.pctLimit;
  const valueLimit = o.valueLimit == null ? 0 : o.valueLimit;
  return lines.map((l) => ({
    ...l,
    flagged: (Math.abs(l.variancePct) >= pctLimit && l.varianceUnits !== 0) || Math.abs(l.varianceValue) >= (valueLimit > 0 ? valueLimit : Infinity)
  }));
}

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildVarianceCSV(lines) {
  const rows = [["sku", "location", "system_qty", "counted_qty", "variance_units", "variance_pct", "unit_cost", "variance_value", "flagged", "notes"]];
  rankByImpact(lines).forEach((l) => rows.push([
    l.sku, l.location, l.systemQty, l.countedQty, l.varianceUnits, l.variancePct, l.unitCost, l.varianceValue,
    l.flagged ? "YES" : "",
    l.missingInCount ? "not counted" : l.missingInSystem ? "not in system" : ""
  ]));
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
}

// Recount sheet: top N lines by impact, with a blank column for the recount.
function buildRecountCSV(lines, n) {
  const top = rankByImpact(lines).filter((l) => l.varianceUnits !== 0).slice(0, Math.max(0, n || 20));
  const rows = [["sku", "location", "system_qty", "first_count", "variance_value", "recount_qty", "recounted_by"]];
  top.forEach((l) => rows.push([l.sku, l.location, l.systemQty, l.countedQty, l.varianceValue, "", ""]));
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n") + "\n";
}

function summarise(lines) {
  const flagged = lines.filter((l) => l.flagged);
  return {
    totalLines: lines.length,
    varianceLines: lines.filter((l) => l.varianceUnits !== 0).length,
    flaggedLines: flagged.length,
    netValue: Math.round(lines.reduce((a, l) => a + l.varianceValue, 0) * 100) / 100,
    grossValue: Math.round(lines.reduce((a, l) => a + Math.abs(l.varianceValue), 0) * 100) / 100
  };
}

const api = { parseCSV, parseStockCSV, parseCombinedCSV, compareCounts, rankByImpact, flagLines, buildVarianceCSV, buildRecountCSV, summarise, csvEscape };
if (typeof module !== "undefined" && module.exports) { module.exports = api; }
if (typeof window !== "undefined") { window.CountVarianceLint = api; }
