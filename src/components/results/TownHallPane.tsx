import type { Persona } from "@/lib/contract";
import { MockTag } from "../MockTag";

export function TownHallPane({ personas, onSelect, mock }: { personas: Persona[]; onSelect: (p: Persona) => void; mock: boolean }) {
  return (
    <div className={`stack-sm ${mock ? "is-mock-section" : ""}`}>
      {mock && (
        <p className="small">
          <MockTag show what="the residents" /> These residents and their numbers are mock placeholders; they are not drawn from this simulation run.
        </p>
      )}
      <p className="small muted">Each resident sees only their own numbers. Choose one to fly to their block and talk to them.</p>
      {personas.map((p) => (
        <button key={p.id} className="card" onClick={() => onSelect(p)}>
          <span className="row">
            <strong className="grow">
              {p.name}, {p.age}
            </strong>
            <span className={`badge stance-${p.stance}`}>{p.stance}</span>
          </span>
          <span className="small muted">{p.descriptor}</span>
          <q>{p.quote}</q>
          <span className="chips">
            {p.stakeChips.map((c) => (
              <span key={c} className="chip mono">
                {c}
              </span>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
