# Deploying the sim service

The sim runs as a Python (FastAPI) function in the Vercel project `whatif-sim`, team
`raphael-omoroses-projects`: https://whatif-sim-gold.vercel.app (`GET /health`, `POST /simulate`).
The web app reaches it through `SIM_URL` (Production) on `whatif-atl`.

## Redeploy (one command, Git Bash, on the laptop that holds `sim/data/`)

```bash
bash /c/Users/rapha/whatif/sim/deploy/deploy.sh                 # sim code from origin/main + its caches
bash /c/Users/rapha/whatif/sim/deploy/deploy.sh --working-tree  # uncommitted sim/ code
BUILD_ONLY=1 bash /c/Users/rapha/whatif/sim/deploy/deploy.sh    # assemble only
```

The script reads the repo and `sim/data/` and never writes to them. It assembles a bundle in
`C:\Users\rapha\whatif-sim-deploy\build`, then runs `vercel deploy --prod` there. Each bundle holds:

- `sim/*.py` and `src/data/gazetteer.json` from the chosen ref.
- `public/scenarios/beltline-streetcar.json`, copied to `scenario_files/` so it stays out of `public/`.
- The caches for the bbox that the packaged `config.py` computes: `data/cache/*_<tag>.pkl`,
  `equity_*.pkl`, `data/corridors_<tag>.json` and `data/marta_gtfs.zip`.

No `*.sim.json` is shipped, so every `/simulate` call runs live. Saved runs are served by the web route.

Code and caches are a matched pair. Rebuild the caches with the same code before deploying it.
Each deploy snapshots the caches it shipped to `whatif-sim-deploy/snapshots/<sha>/`. To roll back:

```bash
DATA_SRC=/c/Users/rapha/whatif-sim-deploy/snapshots/<sha> bash sim/deploy/deploy.sh <sha>
```

`app.py` wraps `sim/main.py` without changing it. It loads the baseline lazily, gzips responses,
and checks the `X-Sim-Token` header on `/simulate`, but only when the `SIM_TOKEN` env var is set
on `whatif-sim`.

## Limits to watch

- Python functions can be up to 500 MB. The core box bundles to about 430 MB, almost all of it
  numpy/scipy/pandas/geopandas.
- Responses are capped at 4.5 MB. A live run with 2,000 agents returns about 3.1 MB.
- A bigger study box adds far larger caches and will not fit under 500 MB without trimming them
  or setting `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`.
