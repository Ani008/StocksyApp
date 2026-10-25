import { INSTRUMENTS } from "../pages/SearchPage";

const LOGO_TOKEN = "pk_Bym4BAakTJudMK4MGnfpnw"; // same public logo.dev key used across the app

export const logoUri = (domain) => `https://img.logo.dev/${domain}?token=${LOGO_TOKEN}`;

// The server sends which stocks to show; the logo domain lives in the app's own
// stock list, so look it up by instrument key.
export const DOMAIN_BY_KEY = new Map(INSTRUMENTS.map((s) => [s.key, s.domain]));
export const META_BY_KEY = new Map(INSTRUMENTS.map((s) => [s.key, s]));
