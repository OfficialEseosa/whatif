"use client";
import { useStore } from "@/lib/store";

/** Map credits, bottom-right (required by the tile providers). Nothing else lives down here. */
export function StatusBar() {
  const attribution = useStore((s) => s.attribution);
  if (!attribution.text && !attribution.google) return null;
  return (
    <p className="credit" title={attribution.text}>
      {/* TODO(Prosper): use Google's official logo asset per Map Tiles API policies. */}
      {attribution.google && <strong>Google </strong>}
      {attribution.text}
    </p>
  );
}
