// GET /api/map-session -> { session, expiry } | 404 when no key   (owner: Prosper)
//
// Creates a Google Map Tiles API 2D session token (dark roadmap) for the Analysis view.
// Request shape per https://developers.google.com/maps/documentation/tile/session_tokens :
//   POST https://tile.googleapis.com/v1/createSession?key=KEY
//   { mapType, language, region, styles? } -> { session, expiry, tileWidth, tileHeight, imageFormat }
// Tiles:  https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=SESSION&key=KEY
// UNTESTED without a key. The key is the public browser key (NEXT_PUBLIC_*), restrict it by referrer.
import { connection } from "next/server";
import { apiError } from "@/lib/http";

let cached: { session: string; expiry: number } | null = null;

// TODO(Prosper/designer): tune the dark style. Style objects follow the Maps JS styling format.
const DARK_STYLE = [
  { stylers: [{ saturation: -80 }, { lightness: -70 }] },
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
    body: JSON.stringify({ mapType: "roadmap", language: "en-US", region: "US", styles: DARK_STYLE }),
  });
  if (!res.ok) return apiError(502, `createSession failed (${res.status})`);
  const json = (await res.json()) as { session: string; expiry: string };
  cached = { session: json.session, expiry: Number(json.expiry) };
  return Response.json(cached);
}
