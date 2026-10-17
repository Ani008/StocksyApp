#!/usr/bin/env node
/*
 * Renames dist/assets/node_modules -> dist/assets/vendor and rewrites every
 * reference to it.
 *
 * WHY: `expo export -p web` puts fonts and images that live inside npm
 * packages (the @expo/vector-icons font that draws every tab-bar icon, the
 * react-navigation back arrow, ...) under dist/assets/node_modules/. Static
 * hosts such as Cloudflare Pages silently drop any folder named
 * "node_modules" when deploying. The font request then falls through to the
 * single-page-app fallback and returns index.html, the font cannot be
 * decoded, and every icon renders as an empty box.
 *
 * Run AFTER `expo export` and BEFORE stamp-sw.mjs:
 *     expo export -p web && node scripts/relocate-node-modules.mjs && node scripts/stamp-sw.mjs
 *
 * Usage: node scripts/relocate-node-modules.mjs [distDir]   (default: dist)
 */
import fs from "node:fs";
import path from "node:path";

const dist = path.resolve(process.argv[2] || "dist");
const from = path.join(dist, "assets", "node_modules");
const to = path.join(dist, "assets", "vendor");

const OLD = "assets/node_modules/";
const NEW = "assets/vendor/";

const TEXT_EXT = new Set([".js", ".html", ".json", ".css", ".map", ".webmanifest"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

if (!fs.existsSync(dist)) {
  console.error(`[relocate-node-modules] ${dist} does not exist. Run the export first.`);
  process.exit(1);
}

if (!fs.existsSync(from)) {
  // Already relocated, or this Expo version no longer emits the folder.
  console.log("[relocate-node-modules] no assets/node_modules folder, nothing to do.");
  process.exit(0);
}

if (fs.existsSync(to)) {
  console.error(`[relocate-node-modules] ${to} already exists; refusing to overwrite.`);
  process.exit(1);
}

fs.renameSync(from, to);

let rewritten = 0;
for (const file of walk(dist)) {
  // Binary assets (fonts, images) never contain the path string.
  if (!TEXT_EXT.has(path.extname(file).toLowerCase())) continue;

  const before = fs.readFileSync(file, "utf8");
  if (!before.includes(OLD)) continue;

  fs.writeFileSync(file, before.split(OLD).join(NEW));
  rewritten += 1;
}

// Fail the build rather than ship a bundle that still points at the old path.
const leftover = walk(dist).filter((file) => {
  if (!TEXT_EXT.has(path.extname(file).toLowerCase())) return false;
  return fs.readFileSync(file, "utf8").includes(OLD);
});

if (leftover.length > 0) {
  console.error("[relocate-node-modules] still references assets/node_modules in:");
  leftover.forEach((file) => console.error("  " + path.relative(dist, file)));
  process.exit(1);
}

console.log(
  `[relocate-node-modules] moved assets/node_modules -> assets/vendor, rewrote ${rewritten} file(s).`,
);
