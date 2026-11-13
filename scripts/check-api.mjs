// Smoke test: hits the three API routes and validates replies against the contract.
// Usage: start the app (npm run dev / npm start), then `npm run check:api [baseUrl]`.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = await import(pathToFileURL(path.join(ROOT, "src/lib/contract.ts")).href);
const base = process.argv[2] || "http://localhost:3000";

async function post(route, body) {
  const res = await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${route} ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

let failed = 0;
const check = (name, schema, value) => {
  const r = schema.safeParse(value);
  console.log(`${r.success ? "ok  " : "FAIL"} ${name}`);
  if (!r.success) { failed++; console.log(r.error.issues.slice(0, 5)); }
  return value;
};

const plan = check("POST /api/plan (prompt)", C.PlanResponseSchema, await post("/api/plan", { text: "extend the streetcar to Ponce City Market", mode: "prompt" }));
const article = check("POST /api/plan (article)", C.PlanResponseSchema, await post("/api/plan", { text: "Backers say it could carry 10,000 riders a day.", mode: "article" }));
const sim = check("POST /api/simulate", C.ScenarioResultSchema, await post("/api/simulate", { edit: plan.edit, claims: article.claims }));
console.log(`     ${sim.agents.length} agents, ${sim.claims.length} claims, isMock=${sim.isMock}`);
const p = sim.personas[0];
check("POST /api/persona", C.PersonaResponseSchema, await post("/api/persona", { scenarioId: sim.id, personaId: p.id, messages: [{ role: "user", content: "How does this change your commute?" }] }));
const bad = await fetch(base + "/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
console.log(`${bad.status === 400 ? "ok  " : "FAIL"} invalid body -> ${bad.status}`);
if (bad.status !== 400) failed++;
process.exit(failed ? 1 : 0);
