// Security review item 14: the dependency-audit gate used by CI.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluate, rootAdvisories } from "../scripts/audit-gate.mjs";

const adv = (id, name, severity = "high") => ({
  name, severity, title: `${name} problem`, url: `https://github.com/advisories/${id}`,
});
// shape of `npm audit --json`: root advisories appear as objects in `via`;
// packages that merely inherit one list the package NAME (a string) instead
const report = (...vulns) => ({
  vulnerabilities: Object.fromEntries(vulns.map(([pkg, via]) => [pkg, { name: pkg, via }])),
});
const allow = (...entries) => ({ advisories: entries.map(([id, reviewBy = "2099-01-01", reason = "because"]) => ({ id, package: "x", reason, reviewBy })) });
const NOW = new Date("2026-10-15");

test("inherited severity is not counted twice: one root advisory, many affected packages", () => {
  const r = report(
    ["braces", [adv("GHSA-aaaa", "braces")]],
    ["micromatch", ["braces"]],
    ["metro", ["micromatch"]],
    ["expo", ["metro"]],
  );
  assert.deepEqual(rootAdvisories(r).map((a) => a.id), ["GHSA-aaaa"]);
});

test("a NEW advisory fails the gate", () => {
  const res = evaluate(report(["axios", [adv("GHSA-new1", "axios", "high")]]), allow(["GHSA-old1"]), NOW);
  assert.equal(res.ok, false);
  assert.equal(res.failures[0].id, "GHSA-new1");
});

test("an accepted advisory passes", () => {
  const res = evaluate(report(["braces", [adv("GHSA-old1", "braces")]]), allow(["GHSA-old1"]), NOW);
  assert.equal(res.ok, true);
  assert.equal(res.failures.length, 0);
});

test("an accepted advisory whose review date has passed fails again", () => {
  const res = evaluate(report(["braces", [adv("GHSA-old1", "braces")]]), allow(["GHSA-old1", "2026-01-01"]), NOW);
  assert.equal(res.ok, false);
  assert.equal(res.expired[0].id, "GHSA-old1");
});

test("an allowlist entry without a reason or review date does not count", () => {
  const bad = { advisories: [{ id: "GHSA-old1", package: "x" }] };
  const res = evaluate(report(["braces", [adv("GHSA-old1", "braces")]]), bad, NOW);
  assert.equal(res.ok, false);
});

test("critical/high/moderate advisories gate; low ones do not", () => {
  for (const sev of ["critical", "high", "moderate"]) {
    assert.equal(evaluate(report(["p", [adv("GHSA-x", "p", sev)]]), allow(), NOW).ok, false, sev);
  }
  assert.equal(evaluate(report(["p", [adv("GHSA-x", "p", "low")]]), allow(), NOW).ok, true);
});

test("a fixed advisory still on the allowlist is reported as stale, not a failure", () => {
  const res = evaluate(report(), allow(["GHSA-gone"]), NOW);
  assert.equal(res.ok, true);
  assert.deepEqual(res.stale, ["GHSA-gone"]);
});

test("a clean report passes", () => {
  assert.equal(evaluate({ vulnerabilities: {} }, allow(), NOW).ok, true);
  assert.equal(evaluate({}, allow(), NOW).ok, true);
});

test("the real allowlist is well-formed and every entry is justified", () => {
  const list = JSON.parse(fs.readFileSync(new URL("../.audit-allowlist.json", import.meta.url), "utf8"));
  assert.ok(list.advisories.length > 0);
  for (const a of list.advisories) {
    assert.match(a.id, /^GHSA-[a-z0-9-]+$/i);
    assert.ok(a.package && a.reason.length > 40, `${a.id} needs a real reason`);
    assert.match(a.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(new Set(list.advisories.map((a) => a.id)).size, list.advisories.length, "no duplicates");
});
