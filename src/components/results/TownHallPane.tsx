import type { Persona } from "@/lib/contract";

const STANCE = { for: "For", against: "Against", mixed: "Mixed" } as const;

export function TownHallPane({ personas, onSelect }: { personas: Persona[]; onSelect: (p: Persona) => void; mock: boolean }) {
  return (
    <ul className="list stack-xs">
      {personas.map((p) => (
        <li key={p.id}>
          <button className="card" onClick={() => onSelect(p)}>
            <span className="row">
              <strong className="grow">
                {p.name}, {p.age}
              </strong>
              <span className={`badge stance-${p.stance}`}>{STANCE[p.stance]}</span>
            </span>
            <span className="small muted">{p.descriptor}</span>
            <q>{p.quote}</q>
          </button>
        </li>
      ))}
    </ul>
  );
}
