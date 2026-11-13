/**
 * Google Photorealistic 3D Tiles via deck.gl Tile3DLayer (Photoreal view when a key is present).
 * Follows deck.gl's google-3d-tiles example, with a tile budget so a laptop doesn't choke:
 * Tileset3D options go through `loadOptions.tileset` (deck.gl 9.4 Tile3DLayer / loaders.gl 4.5 Tileset3D).
 */
import { Tile3DLayer } from "@deck.gl/geo-layers";
import type { Tileset3D } from "@loaders.gl/tiles";
import type { Quality3d } from "@/lib/store";

const ROOT = "https://tile.googleapis.com/v1/3dtiles/root.json";

/**
 * maximumScreenSpaceError: pixels of geometric error allowed before refining (loaders.gl default 8;
 *   higher = coarser tiles, far fewer requests and triangles).
 * maximumMemoryUsage: MB of tile content kept (default 32). Too small thrashes (unload/reload while
 *   orbiting); too large holds GPU memory. memoryAdjustedScreenSpaceError coarsens further when full.
 * maxRequests + throttleRequests: concurrent tile fetches (default 64).
 */
export const TILESET_BUDGET: Record<Quality3d, Record<string, number | boolean>> = {
  low: { maximumScreenSpaceError: 28, maximumMemoryUsage: 96, memoryCacheOverflow: 32, memoryAdjustedScreenSpaceError: true, throttleRequests: true, maxRequests: 12 },
  high: { maximumScreenSpaceError: 12, maximumMemoryUsage: 256, memoryCacheOverflow: 64, memoryAdjustedScreenSpaceError: true, throttleRequests: true, maxRequests: 24 },
};

export function photorealLayer(key: string, onCredits: (credits: string) => void, visible = true, quality: Quality3d = "low") {
  return new Tile3DLayer({
    // id includes the quality: changing it rebuilds the tileset with the new budget.
    id: `google-photoreal-3d-${quality}`,
    data: ROOT,
    loadOptions: { fetch: { headers: { "X-GOOG-API-KEY": key } }, tileset: TILESET_BUDGET[quality] },
    operation: "draw", // overlays carry baked elevation; no terrain source needed
    visible,
    onTilesetLoad: (tileset: Tileset3D) => {
      let last = "";
      tileset.options.onTraversalComplete = (selected) => {
        const credits = new Set<string>();
        for (const tile of selected) {
          const copyright = (tile.content as { gltf?: { asset?: { copyright?: string } } } | undefined)?.gltf?.asset?.copyright;
          copyright?.split(";").forEach((c) => c.trim() && credits.add(c.trim()));
        }
        // Only push to React when the text changes (traversal runs every frame while the camera moves).
        const text = [...credits].join("; ");
        if (text !== last) {
          last = text;
          onCredits(text);
        }
        return selected;
      };
    },
  });
}
