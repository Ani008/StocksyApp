// middleware/securityHeaders.js
//
// Security response headers for the API (security review item 10).
//
// This server only ever returns JSON, so the policy is the strictest one
// possible: the browser is told this origin must never be framed, never run
// scripts, never load sub-resources and never be sniffed into another type.
// (The WEB APP's own headers — the CSP that actually has to allow scripts,
// images and API calls — are set by the web host; see
// Stocksy_Mobile/deploy/.)
//
// Header          Why
// --------------  ---------------------------------------------------------
// CSP             default-src 'none' + frame-ancestors 'none': even if an
//                 API response were ever rendered as HTML it could run nothing
//                 and could not be framed.
// HSTS            Browsers refuse plain-http to this host for 2 years. Only
//                 sent in production (sending it from http://localhost would
//                 be ignored, but there is no reason to emit it).
// nosniff         Stops MIME sniffing of JSON as script/HTML.
// X-Frame-Options Legacy clickjacking guard for browsers without CSP level 2.
// Referrer-Policy API responses never need to leak a URL onward.
// Permissions-    Turns off every powerful browser feature for this origin.
//  Policy
// COOP / CORP     Isolate this origin from other windows/sites. CORP is
//                 "same-site" so www./app. can still use it; normal CORS
//                 fetches are decided by config/cors.js and are unaffected.
// Cache-Control   Default "no-store": balances, orders and sessions must not
//                 sit in a browser/proxy cache. Set BEFORE routing, so a route
//                 that wants caching can still override it (e.g.
//                 /api/app/version sets "public, max-age=60").
// X-Powered-By    Removed (don't advertise "Express").
//
// HSTS_PRELOAD=true adds the `preload` token. Do NOT turn that on casually:
// submitting to hstspreload.org is very hard to undo. Leave it off until every
// subdomain of the domain is permanently HTTPS.

const helmet = require("helmet");

const TWO_YEARS = 63072000;

// Every feature the API (and a page served from this origin) has no use for.
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "bluetooth=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "publickey-credentials-get=()",
  "usb=()",
  "interest-cohort=()",
].join(", ");

function permissionsPolicy(req, res, next) {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  next();
}

function defaultNoStore(req, res, next) {
  // A route may overwrite this with its own Cache-Control.
  res.setHeader("Cache-Control", "no-store");
  next();
}

/**
 * Returns an array of middleware; mount with `app.use(...securityHeaders())`
 * as the FIRST thing in the stack so even 404s, CORS preflights, rate-limit
 * rejections and error responses carry the headers.
 */
function securityHeaders({ env = process.env } = {}) {
  const isProd = env.NODE_ENV === "production";

  const helmetMw = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    strictTransportSecurity: isProd
      ? {
          maxAge: TWO_YEARS,
          includeSubDomains: true,
          preload: env.HSTS_PRELOAD === "true",
        }
      : false,
    xContentTypeOptions: true, // nosniff
    xFrameOptions: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginEmbedderPolicy: false, // nothing to embed; would only add risk
    originAgentCluster: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xPermittedCrossDomainPolicies: { permittedPolicies: "none" },
    xXssProtection: true, // sends "0": switches off the legacy auditor, which is itself exploitable
    hidePoweredBy: true,
  });

  return [helmetMw, permissionsPolicy, defaultNoStore];
}

module.exports = { securityHeaders, PERMISSIONS_POLICY };
