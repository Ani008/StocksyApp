#!/usr/bin/env node
// Dependency-audit gate (security review item 14).
//
// `npm audit` on an Expo app is red forever: build tooling (Metro, Expo CLI)
// carries advisories that have no patched release, and every package above
// them inherits the severity, so 30 entries trace back to 4 real advisories.
// A check that is always red gets ignored, so this gate keeps it meaningful:
//
//   * a NEW advisory (not in .audit-allowlist.json) at or above THRESHOLD  -> FAIL
//   * an allowlist entry whose `reviewBy` date has passed                  -> FAIL
//   * an allowlist entry that no longer matches anything (it was fixed)    -> warning
//   * everything else                                                      -> pass
//
// Run:  npm run audit:gate

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
export const THRESHOLD = "moderate";

/** Every distinct root advisory in an `npm audit --json` report. */
export function rootAdvisories(report) {
  const found = new Map();
  for (const vuln of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (via && typeof via === "object" && via.url) {
        const id = via.url.split("/").pop();
        found.set(id, { id, package: via.name, severity: via.severity, title: via.title });
      }
    }
  }
  return [...found.values()];
}

export function evaluate(report, allowlist, now = new Date()) {
  const accepted = new Map((allowlist?.advisories ?? []).map((a) => [a.id, a]));
  const advisories = rootAdvisories(report);
  const failures = [];
  const expired = [];
  const used = new Set();

  for (const adv of advisories) {
    const entry = accepted.get(adv.id);
    if (entry) {
      used.add(adv.id);
      if (!entry.reason || !entry.reviewBy) {
        failures.push({ ...adv, why: "allowlist entry needs a reason and a reviewBy date" });
      } else if (new Date(entry.reviewBy) < now) {
        expired.push({ ...adv, reviewBy: entry.reviewBy });
      }
    } else if ((RANK[adv.severity] ?? 4) >= RANK[THRESHOLD]) {
      failures.push({ ...adv, why: "new advisory, not in .audit-allowlist.json" });
    }
  }
  const stale = [...accepted.keys()].filter((id) => !used.has(id));
  return { advisories, failures, expired, stale, ok: failures.length === 0 && expired.length === 0 };
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.join(here, "..");
  const allowlist = JSON.parse(fs.readFileSync(path.join(root, ".audit-allowlist.json"), "utf8"));

  // npm exits non-zero whenever it finds anything; the JSON on stdout is what we want.
  const r = spawnSync("npm", ["audit", "--json"], { cwd: root, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(r.stdout); } catch {
    console.error("audit-gate: could not read `npm audit --json` output (registry unreachable?)\n" + (r.stderr || r.stdout));
    process.exit(2);
  }
  if (report.error) { console.error("audit-gate: npm audit failed:", report.error.summary || report.error); process.exit(2); }

  const res = evaluate(report, allowlist);
  console.log(`audit-gate: ${res.advisories.length} root advisories (${Object.entries(report.metadata?.vulnerabilities ?? {}).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ") || "none"} packages affected)`);
  for (const a of res.advisories) {
    const tag = res.failures.some((f) => f.id === a.id) ? "NEW   " : "accept";
    console.log(`  [${tag}] ${a.severity.padEnd(8)} ${a.package.padEnd(22)} ${a.id}`);
  }
  for (const s of res.stale) console.log(`  [fixed ] ${s} is in the allowlist but no longer reported: delete the entry`);
  for (const f of res.failures) console.error(`FAIL: ${f.package} ${f.id}: ${f.why}\n      ${f.title}`);
  for (const e of res.expired) console.error(`FAIL: accepted advisory ${e.package} ${e.id} passed its review date (${e.reviewBy}). Re-check it, then renew or remove the entry.`);
  process.exit(res.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
