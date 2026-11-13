/**
 * Google Photorealistic 3D Tiles via deck.gl Tile3DLayer (Photoreal view when a key is present).
 * Follows deck.gl's google-3d-tiles example. UNTESTED without a key.
 */
import { Tile3DLayer } from "@deck.gl/geo-layers";
import type { Tileset3D } from "@loaders.gl/tiles";

const ROOT = "https://tile.googleapis.com/v1/3dtiles/root.json";

export function photorealLayer(key: string, onCredits: (credits: string) => void, visible = true) {
  return new Tile3DLayer({
    id: "google-photoreal-3d",
    data: ROOT,
    loadOptions: { fetch: { headers: { "X-GOOG-API-KEY": key } } },
    operation: "terrain+draw",
    visible,
    onTilesetLoad: (tileset: Tileset3D) => {
      tileset.options.onTraversalComplete = (selected) => {
        const credits = new Set<string>();
        for (const tile of selected) {
          const copyright = (tile.content as { gltf?: { asset?: { copyright?: string } } } | undefined)?.gltf?.asset?.copyright;
          copyright?.split(";").forEach((c) => c.trim() && credits.add(c.trim()));
        }
        onCredits([...credits].join("; "));
        return selected;
      };
    },
  });
}
