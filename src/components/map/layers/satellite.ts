/**
 * Keyless satellite basemap: Esri World Imagery raster tiles (no API key).
 * Attribution is required whenever these are on screen (see DeckMap).
 * If the tiles can't load (offline), nothing draws and the vector roads carry the map.
 */
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer } from "@deck.gl/layers";

const URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const SATELLITE_CREDIT = "Imagery © Esri, Maxar, Earthstar Geographics";

/** `dimmed` darkens the imagery so the analysis layers read on top of it. */
export function satelliteLayer(dimmed: boolean) {
  return new TileLayer({
    id: "satellite",
    data: URL,
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    renderSubLayers: (props) => {
      const { boundingBox } = props.tile;
      return new BitmapLayer(props, {
        data: undefined,
        image: props.data,
        bounds: [boundingBox[0][0], boundingBox[0][1], boundingBox[1][0], boundingBox[1][1]],
        tintColor: dimmed ? [112, 124, 146] : [205, 210, 220],
      });
    },
    updateTriggers: { renderSubLayers: dimmed },
  });
}
