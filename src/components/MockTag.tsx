/** Marks a section of a sim result that is still mock-derived (not computed by the simulation). */
export function MockTag({ show, what = "this section" }: { show: boolean; what?: string }) {
  if (!show) return null;
  return (
    <span className="badge badge-mock-section" title={`Mock placeholder: ${what} is not computed by the simulation yet`}>
      mock
    </span>
  );
}
