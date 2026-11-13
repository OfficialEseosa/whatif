/**
 * Per-section mock marker. The results card carries one plain "Sample data" label for the whole result
 * (see ResultsPanel), so sections no longer render their own tag. Kept so call sites stay unchanged.
 */
export function MockTag(props: { show: boolean; what?: string }) {
  void props;
  return null;
}
