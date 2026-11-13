// Test-only module resolution so `node --test` can load src/ the way Next does.
//   node --import ./tests/setup/register.mjs --test "tests/**/*.test.ts"
// Handles: `@/x` -> src/x, extensionless relative imports -> .ts/.tsx/index.ts,
// and `.json` imports without import attributes. Owned by the AI-lane manager.
import { registerHooks } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs", ".json"];
// Only rewrite JSON that belongs to the project, never dependencies' JSON.
const OWN_JSON_ROOTS = [path.join(ROOT, "src") + path.sep, path.join(ROOT, "tests") + path.sep];

function tryFile(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) {
    const idx = path.join(base, "index" + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, next) {
    let base = null;
    if (specifier.startsWith("@/")) base = path.join(ROOT, "src", specifier.slice(2));
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base) {
      const file = tryFile(base);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".json") && OWN_JSON_ROOTS.some((r) => fileURLToPath(url).startsWith(r))) {
      const text = readFileSync(fileURLToPath(url), "utf8");
      return { format: "module", source: `export default ${text};`, shortCircuit: true };
    }
    return next(url, context);
  },
});
