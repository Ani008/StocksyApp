// Company logo domains, keyed by NSE symbol. logo.dev looks the logo up by
// domain: https://img.logo.dev/<domain>?token=...
//
// SINGLE SOURCE OF TRUTH. This used to be defined in several places
// (Dashboard's holdings map, Dashboard's stock lists, Search's INSTRUMENTS list,
// which also feeds Watchlist and the stock detail page). Fixing a logo in one
// place left the others broken. Change a domain HERE and every screen follows.
//
// Only symbols whose logo needed a non-obvious domain are read from here by the
// stock lists; the rest keep the domain written next to them.
export const COMPANY_DOMAINS = {
  VEDL: "vedanta-zincinternational.com",
  BEL: "bel-india.in",
  IRFC: "irfc.co.in",
  SUZLON: "suzlon.de",
  RELIANCE: "ril.com",
  TCS: "ice.nl",
  HDFCBANK: "hdfcbank.com",
  INFY: "infosys.com",
  SBIN: "sbi.co.in",
  ICICIBANK: "icicibank.com",
  BHARTIARTL: "airtel.in",
  HCLTECH: "hcltech.com",
  TECHM: "techmahindra.com",
  TATASTEEL: "tatasteelnederland.com",
  JSWSTEEL: "jsw.in",
  SUNPHARMA: "sunpharma.com",
  CIPLA: "cipla.com",
  COALINDIA: "coalindia.in",
  DABUR: "dabur.com",
  BRITANNIA: "britannia.co.in",
};
