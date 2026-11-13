# Request to Prosper: test script + Anthropic SDK dependency

**From:** AI lane · **Owner of the files:** Prosper · **Status:** open

## What

Two changes to `package.json` (and the lockfile via `npm install`):

```diff
   "scripts": {
     "dev": "next dev",
     "build": "next build",
     "start": "next start",
     "lint": "eslint",
+    "test": "node --import ./tests/setup/register.mjs --test \"tests/**/*.test.ts\"",
     "mock": "node --no-warnings scripts/make-mock-scenario.mjs",
     "fetch:osm": "node scripts/fetch-osm.mjs"
   },
   "dependencies": {
+    "@anthropic-ai/sdk": "<current stable>",
```

Command: `npm install @anthropic-ai/sdk` then add the `test` script.

## Why

- `test`: the AI lane uses Node's built-in test runner (no new dependency). The script just
  gives everyone `npm test`. The lane already runs the command directly, so this is
  convenience, not a blocker.
- `@anthropic-ai/sdk`: `/api/plan` and `/api/persona` call Claude through the official SDK.
  **This blocks** the Claude-backed paths of `/api/plan`, `/api/persona` and article claim
  extraction. Deterministic fallbacks are being built meanwhile.

The key is read only from `process.env.ANTHROPIC_API_KEY` (server-side route handlers);
it must also be set in the deployment environment.
