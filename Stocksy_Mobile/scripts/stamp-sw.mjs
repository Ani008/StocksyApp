/**
 * Stamps dist/sw.js with a build id derived from the exported bundle.
 *
 * Why: browsers only detect a new service worker when sw.js changes
 * byte-for-byte. Expo copies public/sw.js into dist/ unchanged, so without
 * this step a new deploy would never be noticed and users would keep
 * running a stale JS bundle forever.
 *
 * The id is a hash of dist/index.html, which references the content-hashed
 * JS bundle — so it changes exactly when the shipped code changes.
 *
 * Usage: node scripts/stamp-sw.mjs [distDir]   (run by `npm run build:web`)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLACEHOLDER = "__BUILD_ID__";

export function computeBuildId(indexHtml) {
  return createHash("sha256").update(indexHtml).digest("hex").slice(0, 12);
}

export function stampServiceWorker(swSource, buildId) {
  if (!swSource.includes(PLACEHOLDER)) {
    throw new Error(`sw.js does not contain ${PLACEHOLDER}; was it already stamped?`);
  }
  return swSource.replaceAll(PLACEHOLDER, buildId);
}

function main() {
  const distDir = resolve(process.argv[2] || "dist");
  const indexPath = join(distDir, "index.html");
  const swPath = join(distDir, "sw.js");

  if (!existsSync(indexPath) || !existsSync(swPath)) {
    console.error(`[stamp-sw] Missing ${indexPath} or ${swPath}. Run "expo export -p web" first.`);
    process.exit(1);
  }

  const buildId = computeBuildId(readFileSync(indexPath));
  writeFileSync(swPath, stampServiceWorker(readFileSync(swPath, "utf8"), buildId));
  console.log(`[stamp-sw] ${swPath} stamped with build id ${buildId}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
