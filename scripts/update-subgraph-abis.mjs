/**
 * Copy ABIs from Hardhat artifacts into the subgraph repo (ABI-only JSON files).
 *
 * Usage (from this repo root):
 *   yarn update:subgraph:abis
 *   SKIP_COMPILE=1 yarn update:subgraph:abis
 *
 * Env:
 *   SUBGRAPH_ABIS_DIR — absolute or relative path to the subgraph abis folder (default: ../subgraph/abis from repo root)
 *   SKIP_COMPILE      — if set, skip `hardhat build` (use existing artifacts)
 *
 * Includes only top-level Solidity files in ./contracts/*.sol (excludes contracts/test and contracts/interfaces).
 * For each file Foo.sol, copies artifacts/contracts/Foo.sol/Foo.json → <dest>/Foo.json as a bare ABI array.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const destDir = process.env.SUBGRAPH_ABIS_DIR
  ? path.resolve(repoRoot, process.env.SUBGRAPH_ABIS_DIR)
  : path.resolve(repoRoot, "..", "subgraph", "abis");

const contractsDir = path.join(repoRoot, "contracts");
const artifactsRoot = path.join(repoRoot, "artifacts", "contracts");

if (!process.env.SKIP_COMPILE) {
  const r = spawnSync("yarn", ["hardhat", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (r.error) {
    console.error(r.error);
    process.exit(1);
  }
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

if (!fs.existsSync(contractsDir)) {
  console.error(`[update-subgraph-abis] contracts folder not found: ${contractsDir}`);
  process.exit(1);
}

const entries = fs.readdirSync(contractsDir, { withFileTypes: true });
const contractNames = entries
  .filter((e) => e.isFile() && e.name.endsWith(".sol"))
  .map((e) => e.name.replace(/\.sol$/, ""));

fs.mkdirSync(destDir, { recursive: true });

let copied = 0;
const mergedEvents = [];
const seenEventKeys = new Set();

function eventKey(item) {
  // Deduplicate by structural event identity (name + anonymous + full input schema).
  const inputs = Array.isArray(item.inputs)
    ? item.inputs.map((i) => ({
        type: i.type,
        indexed: Boolean(i.indexed),
        name: i.name ?? "",
        components: i.components ?? [],
      }))
    : [];
  return JSON.stringify({
    type: item.type,
    name: item.name ?? "",
    anonymous: Boolean(item.anonymous),
    inputs,
  });
}

for (const name of contractNames) {
  const artifactPath = path.join(artifactsRoot, `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(artifactPath)) {
    console.warn(`[update-subgraph-abis] skip ${name}: missing artifact ${artifactPath}`);
    continue;
  }
  let artifact;
  try {
    artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  } catch (e) {
    console.warn(`[update-subgraph-abis] skip ${name}: invalid JSON ${artifactPath}`, e);
    continue;
  }
  if (!Array.isArray(artifact.abi)) {
    console.warn(`[update-subgraph-abis] skip ${name}: no abi array in artifact`);
    continue;
  }
  const outPath = path.join(destDir, `${name}.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(artifact.abi, null, 2)}\n`, "utf8");
  console.log(`[update-subgraph-abis] wrote ${outPath}`);

  // Merge events only (deduplicated) into one ABI file.
  for (const item of artifact.abi) {
    if (!item || item.type !== "event") continue;
    const key = eventKey(item);
    if (seenEventKeys.has(key)) continue;
    seenEventKeys.add(key);
    mergedEvents.push(item);
  }

  copied += 1;
}

const mergedOutPath = path.join(destDir, "MergedEvents.json");
fs.writeFileSync(mergedOutPath, `${JSON.stringify(mergedEvents, null, 2)}\n`, "utf8");
console.log(
  `[update-subgraph-abis] wrote ${mergedOutPath} (${mergedEvents.length} unique event(s))`
);

console.log(`[update-subgraph-abis] done: ${copied} file(s) → ${destDir}`);
