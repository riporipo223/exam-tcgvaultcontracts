#!/usr/bin/env node
/**
 * For coverage we only compile 0.8.27 contracts. Fork-only contracts (Pancake*, WBNB)
 * use 0.4.18/0.5.16/0.6.6 and conflict with Hardhat's coverage library. This script
 * renames them to .bak so they are skipped, then restores them after coverage.
 * Usage: node scripts/coverage-exclude-fork-contracts.mjs hide|show
 */
import { renameSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS_TEST = join(ROOT, "contracts", "test");
const FILES = ["WBNB.sol", "PancakeRouter.sol", "PancakeFactory.sol", "PancakePair.sol"];

function hide() {
  for (const f of FILES) {
    const p = join(CONTRACTS_TEST, f);
    if (existsSync(p)) renameSync(p, p + ".bak");
  }
}

function show() {
  for (const f of FILES) {
    const p = join(CONTRACTS_TEST, f);
    const bak = p + ".bak";
    if (existsSync(bak)) renameSync(bak, p);
  }
}

const cmd = process.argv[2];
if (cmd === "hide") hide();
else if (cmd === "show") show();
else {
  console.error("Usage: coverage-exclude-fork-contracts.mjs hide|show");
  process.exit(1);
}
