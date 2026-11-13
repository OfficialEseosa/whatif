import type { Persona } from "@/lib/contract";

const STANCE = { for: "For", against: "Against", mixed: "Undecided" } as const;

export function TownHallPane({ personas, onSelect, mock }: { personas: Persona[]; onSelect: (p: Persona) => void; mock: boolean }) {
  if (!personas.length) return <p className="muted">No residents to ask for this plan.</p>;
  return (
    <div className="stack-sm">
      <p className="pane-hint">Pick a resident to ask what they think of the plan.</p>
      <ul className="list stack-xs">
        {personas.map((p) => (
          <li key={p.id}>
            <button className="card" onClick={() => onSelect(p)}>
              <span className="row">
                <strong className="grow">
                  {p.name}, {p.age}
                </strong>
                {!mock && <span className={`badge stance-${p.stance}`}>{STANCE[p.stance]}</span>}
              </span>
              <span className="small muted">{p.descriptor}</span>
              {!mock && <q>{p.quote}</q>}
              <span className="item-go">Ask {p.name.split(" ")[0]}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
