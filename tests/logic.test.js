"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/logic.js");

const SYSTEM = "sku,location,qty,unit cost\nWIDGET-1,A1,100,2.50\nGADGET-2,B2,50,10.00\nTHING-3,A1,20,5.00\n";
const COUNTED = "sku,location,qty\nWIDGET-1,A1,96\nGADGET-2,B2,50\nTHING-3,A1,35\nEXTRA-9,C3,7\n";

test("parseStockCSV reads sku, location, qty and cost", () => {
  const { items, warnings } = L.parseStockCSV(SYSTEM, {});
  assert.equal(items.length, 3);
  assert.equal(items[0].key, "WIDGET-1 @ A1");
  assert.equal(items[0].cost, 2.5);
  assert.equal(warnings.length, 0);
});

test("parseStockCSV warns on duplicate composite keys", () => {
  const { duplicates } = L.parseStockCSV("sku,location,qty\nA,X,1\nA,X,2\nA,Y,3\n", {});
  assert.deepEqual(duplicates, ["A @ X"]);
});

test("the same SKU in two locations is two distinct keys", () => {
  const sys = L.parseStockCSV("sku,location,qty\nA,X,10\nA,Y,10\n", {}).items;
  const cnt = L.parseStockCSV("sku,location,qty\nA,X,9\nA,Y,10\n", {}).items;
  const lines = L.compareCounts(sys, cnt);
  assert.equal(lines.length, 2);
  assert.equal(lines.find((l) => l.location === "X").varianceUnits, -1);
  assert.equal(lines.find((l) => l.location === "Y").varianceUnits, 0);
});

test("compareCounts computes variance units, value and percent", () => {
  const sys = L.parseStockCSV(SYSTEM, {}).items;
  const cnt = L.parseStockCSV(COUNTED, {}).items;
  const lines = L.compareCounts(sys, cnt);
  const w = lines.find((l) => l.sku === "WIDGET-1");
  assert.equal(w.varianceUnits, -4);
  assert.equal(w.varianceValue, -10);
  assert.equal(w.variancePct, -4);
  const t = lines.find((l) => l.sku === "THING-3");
  assert.equal(t.varianceValue, 75);
});

test("compareCounts marks lines missing on one side", () => {
  const sys = L.parseStockCSV(SYSTEM, {}).items;
  const cnt = L.parseStockCSV(COUNTED, {}).items;
  const lines = L.compareCounts(sys, cnt);
  const extra = lines.find((l) => l.sku === "EXTRA-9");
  assert.equal(extra.missingInSystem, true);
  assert.equal(extra.systemQty, 0);
});

test("rankByImpact orders by absolute value, biggest first", () => {
  const sys = L.parseStockCSV(SYSTEM, {}).items;
  const cnt = L.parseStockCSV(COUNTED, {}).items;
  const ranked = L.rankByImpact(L.compareCounts(sys, cnt));
  assert.equal(ranked[0].sku, "THING-3");
  assert.equal(ranked[ranked.length - 1].varianceValue, 0);
});

test("flagLines flags lines over the percent threshold", () => {
  const sys = L.parseStockCSV(SYSTEM, {}).items;
  const cnt = L.parseStockCSV(COUNTED, {}).items;
  const flagged = L.flagLines(L.compareCounts(sys, cnt), { pctLimit: 5 });
  assert.equal(flagged.find((l) => l.sku === "THING-3").flagged, true); // +75 pct
  assert.equal(flagged.find((l) => l.sku === "WIDGET-1").flagged, false); // -4 pct
});

test("parseCombinedCSV splits system and counted columns", () => {
  const combined = "sku,location,system qty,counted qty,unit cost\nA,X,10,8,3\n";
  const out = L.parseCombinedCSV(combined);
  assert.equal(out.error, null);
  const lines = L.compareCounts(out.system.items, out.counted.items);
  assert.equal(lines[0].varianceUnits, -2);
  assert.equal(lines[0].varianceValue, -6);
});

test("buildRecountCSV takes the top N variance lines with blank recount columns", () => {
  const sys = L.parseStockCSV(SYSTEM, {}).items;
  const cnt = L.parseStockCSV(COUNTED, {}).items;
  const csv = L.buildRecountCSV(L.compareCounts(sys, cnt), 1);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith("THING-3,A1,20,35,75,,"));
});

test("summarise totals net and gross variance value", () => {
  const sys = L.parseStockCSV(SYSTEM, {}).items;
  const cnt = L.parseStockCSV(COUNTED, {}).items;
  const s = L.summarise(L.flagLines(L.compareCounts(sys, cnt), {}));
  assert.equal(s.netValue, 65); // -10 + 0 + 75 + 0 (EXTRA-9 has no cost)
  assert.equal(s.grossValue, 85);
  assert.equal(s.varianceLines, 3);
});
