/**
 * Google Map Tiles API 2D roadmap tiles (Map view when a key is present).
 * Session token comes from /api/map-session. The layer instance is memoized in DeckMap (stable id and
 * URL), so its tile cache survives re-renders.
 */
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer } from "@deck.gl/layers";

export function google2dLayer(session: string, key: string, opacity = 1) {
  return new TileLayer({
    id: "google-2d",
    data: `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`,
    minZoom: 0,
    maxZoom: 22,
    tileSize: 256, // logical size; the session requests 2x high-DPI images so text stays crisp at DPR 1.75
    opacity,
    // Keep whatever is loaded (parents/children) on screen until the new tiles arrive: no blank flashes.
    refinementStrategy: "best-available",
    // Keep a few hundred small tiles in memory so zooming/panning back doesn't re-fetch (the browser
    // HTTP cache covers the rest: same URL, same session).
    maxCacheSize: 600,
    maxRequests: 12,
    // Wait until a wheel/drag gesture settles before requesting new tiles; parents scale meanwhile.
    debounceTime: 80,
    renderSubLayers: (props) => {
      const { boundingBox } = props.tile;
      return new BitmapLayer(props, {
        data: undefined,
        image: props.data,
        bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]],
      });
    },
  });
}

/** Attribution string for the visible area (required whenever these tiles are on screen). */
export async function fetchGoogle2dAttribution(
  session: string,
  key: string,
  zoom: number,
  bounds: { north: number; south: number; east: number; west: number },
): Promise<string> {
  const q = new URLSearchParams({ session, key, zoom: String(Math.round(zoom)), ...Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(`https://tile.googleapis.com/tile/v1/viewport?${q}`);
  if (!res.ok) return "Google";
  const json = (await res.json()) as { copyright?: string };
  return json.copyright || "Google";
}
