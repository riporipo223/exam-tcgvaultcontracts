#!/usr/bin/env node
/**
 * Print coverage for production contracts only (exclude contracts/test and contracts/interfaces).
 * Run: yarn coverage && node scripts/coverage-production-only.mjs
 */
import { readFileSync } from "fs";

const exclude = ["contracts/test/", "contracts/interfaces/"];
function isProduction(path) {
  return path && !exclude.some((p) => path.includes(p));
}

try {
  const lcov = readFileSync("coverage/lcov.info", "utf8");
  const files = new Map();
  for (const record of lcov.split("end_of_record")) {
    const sf = record.match(/SF:(.+)/);
    const lf = record.match(/LF:(\d+)/);
    const lh = record.match(/LH:(\d+)/);
    if (sf && lf && lh) {
      const path = sf[1].trim();
      if (isProduction(path)) {
        const lfn = parseInt(lf[1], 10);
        const lhn = parseInt(lh[1], 10);
        const pct = lfn ? ((lhn / lfn) * 100).toFixed(2) : "100.00";
        const name = path.replace("contracts/", "").replace(".sol", "");
        files.set(name, { path, linePct: pct, covered: lhn, total: lfn });
      }
    }
  }
  console.log("\n=== Production contracts only (excluding test/ and interfaces/) ===\n");
  const sorted = [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, data] of sorted) {
    const status = data.linePct === "100.00" ? "✓" : " ";
    console.log(`${status} ${name}: ${data.linePct}% (${data.covered}/${data.total} lines)`);
  }
  const totalCov = [...files.values()];
  const totalLines = totalCov.reduce((s, d) => s + d.total, 0);
  const totalCovered = totalCov.reduce((s, d) => s + d.covered, 0);
  const totalPct = totalLines ? ((totalCovered / totalLines) * 100).toFixed(2) : "100";
  console.log(`\nTotal production: ${totalPct}% (${totalCovered}/${totalLines} lines)`);
} catch (e) {
  console.error("Run yarn coverage first.");
  process.exit(1);
}
