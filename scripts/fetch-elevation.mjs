// Bakes ground-elevation grids so photoreal overlays can sit on the 3D tiles without deck.gl's
// TerrainExtension (which re-renders the terrain every frame the camera moves).
//
//   npm run fetch:elevation   -> public/elevation/atl.json
//
// Two grids: CORE_BBOX at 0.0005 deg (~46 x 55 m) and STUDY_BBOX at 0.002 deg (~185 x 220 m).
// Source: AWS Terrain Tiles (Terrarium PNG, zoom 14, ~9.5 m pixels), public on the AWS Registry of
// Open Data; in the US they are built from the USGS 3DEP / NED bare-earth DEM, so heights are
// orthometric (NAVD88-like) metres. (The USGS getSamples service was returning 504s.)
// Google Photorealistic 3D Tiles use WGS84 ellipsoidal heights, so the app adds the GEOID18 geoid
// height for Atlanta (NOAA NGS: -29.57 m at 33.765N 84.375W) when it samples the grid.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { STUDY_BBOX, CORE_BBOX } = await import(pathToFileURL(path.join(ROOT, "src/lib/geo.ts")).href);
const OUT = path.join(ROOT, "public/elevation/atl.json");
const GEOID_M = -29.57;
const Z = 14;
const TILE_URL = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;

/** Minimal PNG decoder for 8-bit RGB/RGBA, non-interlaced (what Terrarium tiles are). */
function decodePng(buf) {
  let pos = 8;
  let width = 0, height = 0, channels = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error("unsupported PNG");
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

const n = 2 ** Z;
const lngToX = (lng) => ((lng + 180) / 360) * n;
const latToY = (lat) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
const tiles = new Map();
async function tile(x, y) {
  const k = `${x}/${y}`;
  if (!tiles.has(k)) {
    let buf;
    for (let attempt = 0; attempt < 5 && !buf; attempt++) {
      try {
        const res = await fetch(TILE_URL(x, y));
        if (res.ok) buf = Buffer.from(await res.arrayBuffer());
      } catch {}
      if (!buf) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (!buf) throw new Error(`tile ${k} failed`);
    tiles.set(k, decodePng(buf));
  }
  return tiles.get(k);
}
async function heightAt(lng, lat) {
  const fx = lngToX(lng), fy = latToY(lat);
  const tx = Math.floor(fx), ty = Math.floor(fy);
  const t = await tile(tx, ty);
  const px = Math.min(t.width - 1, Math.floor((fx - tx) * t.width));
  const py = Math.min(t.height - 1, Math.floor((fy - ty) * t.height));
  const i = (py * t.width + px) * t.channels;
  return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
}

async function sampleGrid(bbox, step, label) {
  const nx = Math.round((bbox[2] - bbox[0]) / step) + 1;
  const ny = Math.round((bbox[3] - bbox[1]) / step) + 1;
  const values = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) values.push(Math.round((await heightAt(bbox[0] + i * step, bbox[1] + j * step)) * 10) / 10);
    process.stdout.write(`\r${label} row ${j + 1}/${ny}, ${tiles.size} tiles   `);
  }
  return { bbox: [...bbox], step, nx, ny, values };
}

const core = await sampleGrid(CORE_BBOX, 0.0005, "core");
const wide = await sampleGrid(STUDY_BBOX, 0.002, "wide");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({
    source: `AWS Terrain Tiles (Terrarium, z${Z}; US data from USGS 3DEP/NED), orthometric metres`,
    datum: "NAVD88 (via USGS NED)",
    geoidHeightM: GEOID_M,
    geoidSource: "NOAA NGS GEOID18 at 33.765N 84.375W",
    grids: [core, wide],
  }),
);
console.log(`\nwrote ${OUT} (${(fs.statSync(OUT).size / 1e3).toFixed(0)} kB)`);
