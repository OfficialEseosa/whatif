# Request to Raphael: optional `synthetic` flag on Persona

**From:** AI lane · **Owner of the file:** Raphael (`src/lib/contract.ts`, mirrored in `sim/contract.py`) · **Status:** open

## What (additive, no version bump needed for consumers)

```diff
 export const PersonaSchema = z.object({
   id: z.string(),
+  /** Always true: personas are synthetic composites built from model output, not real residents. */
+  synthetic: z.literal(true).optional(),
   /** First name only. */
   name: z.string(),
```

Plus the matching optional field in `sim/contract.py`, and `synthetic: true` on personas
written by `scripts/make-mock-scenario.mjs` / `sim/export.py` if you agree.

## Why

Every persona must be clearly identified as synthetic. Today the AI lane does this in the
persona's reply text only. A schema flag lets the UI show a "Synthetic resident" badge
consistently, without parsing text. The field is optional, so nothing existing breaks.
