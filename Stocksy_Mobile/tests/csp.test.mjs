// Security review item 10 — web host headers + "strict CSP is possible".
// These tests guard the two things that would silently break the policy:
//   1. someone adds an inline <script> / inline handler to index.html
//   2. the nginx config and the _headers file drift apart

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const nginx = read("deploy/nginx-security-headers.conf");
const netlify = read("deploy/_headers");

const cspFrom = (text, re) => {
  const m = text.match(re);
  assert.ok(m, "CSP line not found");
  return m[1].trim();
};
const nginxCsp = cspFrom(nginx, /add_header Content-Security-Policy "([^"]+)" always;/);
const headersCsp = cspFrom(netlify, /Content-Security-Policy: (.+)/);

const directives = Object.fromEntries(
  nginxCsp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...vals] = d.split(/\s+/);
    return [name, vals];
  }),
);

test("nginx and _headers use the identical CSP", () => {
  assert.equal(nginxCsp, headersCsp);
});

test("index.html has no inline scripts or inline event handlers", () => {
  const html = read("public/index.html");
  const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
    ([, attrs, body]) => !/\bsrc\s*=/.test(attrs) || body.trim() !== "",
  );
  assert.equal(inline.length, 0, "inline <script> would be blocked by script-src 'self'");
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "inline on*= handler would be blocked");
  assert.doesNotMatch(html, /javascript:/i);
});

test("CSP: scripts are same-origin only, with no unsafe-inline / unsafe-eval", () => {
  assert.deepEqual(directives["script-src"], ["'self'"]);
  assert.ok(!nginxCsp.includes("unsafe-eval"));
});

test("CSP: cannot be framed, no plugins, no <base> hijack", () => {
  assert.deepEqual(directives["frame-ancestors"], ["'none'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["base-uri"], ["'self'"]);
});

test("CSP: network access is limited to this origin and the API", () => {
  assert.deepEqual(directives["connect-src"], [
    "'self'",
    "https://api.stocksy.online",
    "wss://api.stocksy.online",
  ]);
});

test("CSP connect-src matches the production API/WS URLs", () => {
  const env = read(".env.production.example");
  const api = new URL(env.match(/EXPO_PUBLIC_API_BASE_URL=(\S+)/)[1]).origin;
  const ws = env.match(/EXPO_PUBLIC_WS_URL=(\S+)/)[1].replace(/\/$/, "");
  assert.ok(directives["connect-src"].includes(api), `${api} missing from connect-src`);
  assert.ok(directives["connect-src"].includes(ws), `${ws} missing from connect-src`);
});

test("all remaining headers are present in both deploy files", () => {
  const names = [
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
  ];
  for (const n of names) {
    assert.ok(nginx.includes(`add_header ${n} `), `${n} missing from nginx`);
    assert.ok(netlify.includes(`${n}:`), `${n} missing from _headers`);
  }
});

test("COOP keeps popups working (Google sign-in uses a popup)", () => {
  assert.match(nginx, /Cross-Origin-Opener-Policy "same-origin-allow-popups"/);
  assert.match(netlify, /Cross-Origin-Opener-Policy: same-origin-allow-popups/);
});

test("every external host used by the app's images is covered by img-src", () => {
  // Fails if someone hot-links a new image host without updating the CSP.
  const src = ["src/pages/BasketsPage.js", "src/pages/DashboardPage.js", "src/pages/StockDetailPage.js", "src/pages/SearchPage.js"]
    .map(read).join("\n");
  const hosts = new Set([...src.matchAll(/https:\/\/([a-z0-9.-]+)\//gi)].map((m) => m[1]));
  const imgHosts = directives["img-src"].map((v) => v.replace("https://", ""));
  for (const h of hosts) {
    if (/^(www\.)?(stocksy\.online|stocksy\.app)$/.test(h)) continue;
    assert.ok(imgHosts.includes(h), `${h} is used in the UI but not allowed by img-src`);
  }
});
