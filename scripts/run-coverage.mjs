#!/usr/bin/env node
/**
 * Run Hardhat coverage with a single compiler by temporarily excluding
 * fork-only contracts (old Solidity versions). Restores them afterward.
 */
import { spawnSync } from "child_process";
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

hide();
let exitCode = 1;
try {
  const r = spawnSync(
    "yarn",
    ["hardhat", "test", "--coverage", "--config", "hardhat.coverage.config.ts"],
    { cwd: ROOT, stdio: "inherit", shell: true }
  );
  exitCode = r.status ?? 1;
} finally {
  show();
}
process.exit(exitCode);
