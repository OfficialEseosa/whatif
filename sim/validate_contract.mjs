// Validate sim output against the real zod contract (src/lib/contract.ts).
//   node --experimental-strip-types sim/validate_contract.mjs public/scenarios/baseline.sim.json [...more]
// Needs the repo's node_modules (zod) installed by the frontend; installs nothing.
import { readFileSync } from "node:fs";
import { ScenarioResultSchema } from "../src/lib/contract.ts";

let failed = 0;
for (const file of process.argv.slice(2)) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const r = ScenarioResultSchema.safeParse(data);
  if (r.success) {
    console.log(`OK   ${file}`);
  } else {
    failed++;
    console.log(`FAIL ${file}`);
    for (const issue of r.error.issues.slice(0, 20)) {
      console.log(`  ${issue.path.join(".")}: ${issue.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
