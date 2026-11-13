"use client";
import { useStore } from "@/lib/store";
import { CheckIcon } from "../icons";

/** Steps of the current build, shown in the results card while it runs. */
export function PipelineOverlay() {
  const steps = useStore((s) => s.pipeline);
  if (!steps.length) return null;
  return (
    <ol className="pipeline list" aria-live="polite" aria-label="Build progress">
      {steps.map((s) => (
        <li key={s.id} className={`pipeline-step is-${s.status}`}>
          <span className="pipeline-mark">{s.status === "done" && <CheckIcon />}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}
