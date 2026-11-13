"use client";
import { useStore } from "@/lib/store";

const MARK = { pending: "·", active: "›", done: "✓" } as const;

export function PipelineOverlay() {
  const steps = useStore((s) => s.pipeline);
  if (!steps.length) return null;
  return (
    <ol className="map-ui map-ui-tl panel-float mono small list" aria-live="polite" aria-label="Pipeline progress">
      {steps.map((s) => (
        <li key={s.id} className={`pipeline-step is-${s.status}`}>
          {MARK[s.status]} {s.label}
        </li>
      ))}
    </ol>
  );
}
