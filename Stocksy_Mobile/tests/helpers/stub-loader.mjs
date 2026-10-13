// Lets plain `node --test` load the app's ES-module service files (which are
// .js files in a package without "type": "module") and replaces the React
// Native / Expo / axios imports with the in-memory fakes from ./stubs.mjs.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const stubs = pathToFileURL(path.join(here, "stubs.mjs")).href;
const STUBBED = {
  "react-native": `${stubs}?m=rn`,
  "@react-native-async-storage/async-storage": `${stubs}?m=async`,
  "expo-secure-store": `${stubs}?m=secure`,
  axios: `${stubs}?m=axios`,
};

export async function resolve(specifier, context, next) {
  if (STUBBED[specifier]) return { url: STUBBED[specifier], shortCircuit: true };
  if (specifier.endsWith("src/config/env")) {
    return { url: `${stubs}?m=env`, shortCircuit: true };
  }
  // Metro resolves extension-less relative imports; plain Node does not.
  if (specifier.startsWith(".") && !path.extname(specifier) && context.parentURL?.startsWith("file://")) {
    const candidate = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier + ".js");
    if (fs.existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith("file://") && url.includes("/services/") && url.endsWith(".js")) {
    return {
      format: "module",
      source: fs.readFileSync(fileURLToPath(url), "utf8"),
      shortCircuit: true,
    };
  }
  return next(url, context);
}
