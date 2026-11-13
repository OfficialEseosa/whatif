// GET /api/map-session -> { session, expiry } | 404 when no key   (owner: Prosper)
//
// Creates a Google Map Tiles API 2D session token (satellite with road and place labels) for the Analysis view.
// Request shape per https://developers.google.com/maps/documentation/tile/session_tokens :
//   POST https://tile.googleapis.com/v1/createSession?key=KEY
//   { mapType, language, region, styles? } -> { session, expiry, tileWidth, tileHeight, imageFormat }
// Tiles:  https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=SESSION&key=KEY
// UNTESTED without a key. The key is the public browser key (NEXT_PUBLIC_*), restrict it by referrer.
import { connection } from "next/server";
import { apiError } from "@/lib/http";

let cached: { session: string; expiry: number } | null = null;

// Labels drawn over the imagery. Style objects follow the Maps JS styling format.
const LABEL_STYLE = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

export async function GET() {
  await connection(); // request-time only (cacheComponents would otherwise prerender this)
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) return apiError(404, "no Google Maps key configured");
  if (cached && cached.expiry * 1000 > Date.now() + 60_000) return Response.json(cached);
  const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapType: "satellite", layerTypes: ["layerRoadmap"], language: "en-US", region: "US", styles: LABEL_STYLE }),
  });
  if (!res.ok) return apiError(502, `createSession failed (${res.status})`);
  const json = (await res.json()) as { session: string; expiry: string };
  cached = { session: json.session, expiry: Number(json.expiry) };
  return Response.json(cached);
}
