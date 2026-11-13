import type { Persona } from "@/lib/contract";

export function TownHallPane({ personas, onSelect }: { personas: Persona[]; onSelect: (p: Persona) => void }) {
  return (
    <div className="stack-sm">
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
