#!/usr/bin/env bash
# Package the WhatIf ATL sim service + the caches its study box needs, and deploy it to the
# Vercel project "whatif-sim" (production, https://whatif-sim-gold.vercel.app). Run from Git Bash:
#
#   bash /c/Users/rapha/whatif-sim-deploy/deploy.sh               # code from origin/main (fetched)
#   bash /c/Users/rapha/whatif-sim-deploy/deploy.sh <git-ref>     # code from any commit/branch
#   bash /c/Users/rapha/whatif-sim-deploy/deploy.sh --working-tree  # uncommitted sim/ code as it is now
#   BUILD_ONLY=1 bash .../deploy.sh                               # assemble build/ and stop (local test)
#   EXTRA_DATA="x.csv" bash .../deploy.sh                         # also ship files from sim/data/
#   DATA_SRC=/c/Users/rapha/whatif-sim-deploy/snapshots/3f52735 bash .../deploy.sh 3f52735   # rollback pair
#
# Reads the repo and sim/data/ only; never writes to the repo. Caches are picked by the bbox tag
# that the packaged sim/config.py computes (env WHATIF_BBOX honoured the same way the sim does).
set -euo pipefail

REPO="${REPO:-/c/Users/rapha/whatif}"
HERE="$(cd "$(dirname "$0")" && pwd)"            # holds app.py, vercel.json, .python-version, .vercelignore
[ -d "$HERE/overlay" ] && OVERLAY="$HERE/overlay" || OVERLAY="$HERE"
STAGE="${WORK:-/c/Users/rapha/whatif-sim-deploy}"  # build/, snapshots/, .vercel link (outside the repo)
mkdir -p "$STAGE"
BUILD="$STAGE/build"
SRC="${1:-origin/main}"
PY="${PY:-$REPO/sim/.venv/Scripts/python.exe}"
[ -x "$PY" ] || PY=python

rm -rf "$BUILD"
mkdir -p "$BUILD"

if [ "$SRC" = "--working-tree" ]; then
  echo "code: working tree of $REPO"
  mkdir -p "$BUILD/sim" "$BUILD/src/data" "$BUILD/public/scenarios"
  cp "$REPO"/sim/*.py "$REPO/sim/requirements.txt" "$BUILD/sim/"
  cp "$REPO/src/data/gazetteer.json" "$BUILD/src/data/"
  cp "$REPO"/public/scenarios/*.json "$BUILD/public/scenarios/"
else
  git -C "$REPO" fetch -q origin
  echo "code: $SRC ($(git -C "$REPO" rev-parse --short "$SRC"))"
  git -C "$REPO" archive "$SRC" sim src/data/gazetteer.json public/scenarios | tar -x -C "$BUILD"
fi
mkdir -p "$BUILD/scenario_files"
[ -f "$BUILD/public/scenarios/beltline-streetcar.json" ] && cp "$BUILD/public/scenarios/beltline-streetcar.json" "$BUILD/scenario_files/"
rm -rf "$BUILD/public"
rm -rf "$BUILD/sim/deploy"
rm -f "$BUILD"/sim/smoke_test.py "$BUILD"/sim/validate_contract.mjs "$BUILD"/sim/.gitignore

TAG="$(cd "$BUILD/sim" && "$PY" -I -c 'import sys; sys.path.insert(0, "."); import config; print(config.bbox_tag())')"
echo "bbox tag: $TAG"

# DATA_SRC: a folder laid out like sim/data (cache/ inside). Default: the live sim/data/ of the repo.
# Use a snapshot (snapshots/<sha>/) to redeploy a known-good code+cache pair.
DATA_SRC="${DATA_SRC:-$REPO/sim/data}"
echo "data: $DATA_SRC"
mkdir -p "$BUILD/sim/data/cache"
shopt -s nullglob
n=0
for f in "$DATA_SRC"/cache/*_"$TAG".pkl "$DATA_SRC"/cache/equity_*.pkl; do
  cp -p "$f" "$BUILD/sim/data/cache/"; n=$((n+1))
done
for f in "$DATA_SRC"/*_"$TAG".json; do cp -p "$f" "$BUILD/sim/data/"; done
for f in marta_gtfs.zip ${EXTRA_DATA:-}; do [ -f "$DATA_SRC/$f" ] && cp -p "$DATA_SRC/$f" "$BUILD/sim/data/"; done
[ -f "$BUILD/sim/data/cache/baseline_$TAG.pkl" ] || { echo "ERROR: no baseline_$TAG.pkl in $DATA_SRC/cache (build it first)"; exit 1; }
echo "copied $n cache files"
# keep what was shipped as a matched code+cache pair for rollback
if [ "$SRC" != "--working-tree" ]; then SNAP="$STAGE/snapshots/$(git -C "$REPO" rev-parse --short "$SRC")"; else SNAP="$STAGE/snapshots/wt-$(date +%H%M)"; fi
if [[ "$DATA_SRC" != "$STAGE"/snapshots/* ]] && [ ! -d "$SNAP" ]; then
  mkdir -p "$SNAP/cache"; cp -p "$BUILD"/sim/data/cache/* "$SNAP/cache/"; cp -p "$BUILD"/sim/data/*.* "$SNAP/" 2>/dev/null || true
  echo "snapshot: $SNAP"
fi

# Runtime requirements: the sim's pins minus build-only packages.
if [ -f "$BUILD/sim/requirements-runtime.txt" ]; then cp "$BUILD/sim/requirements-runtime.txt" "$BUILD/requirements.txt"
else grep -viE '^(osmnx|uvicorn|requests|osmium)\b' "$BUILD/sim/requirements.txt" > "$BUILD/requirements.txt"; fi
cp "$OVERLAY/app.py" "$OVERLAY/vercel.json" "$OVERLAY/.python-version" "$OVERLAY/.vercelignore" "$BUILD/"
[ -d "$STAGE/.vercel" ] && cp -r "$STAGE/.vercel" "$BUILD/"

du -sh "$BUILD"
[ -n "${BUILD_ONLY:-}" ] && { echo "BUILD_ONLY set: not deploying ($BUILD)"; exit 0; }

cd "$BUILD"
vercel deploy --prod --yes --scope raphael-omoroses-projects
# first run links the folder; keep the link for next time
[ -d "$BUILD/.vercel" ] && [ ! -d "$STAGE/.vercel" ] && cp -r "$BUILD/.vercel" "$STAGE/"
echo "check: curl -s https://whatif-sim-gold.vercel.app/health"
