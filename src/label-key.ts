/** Shared case-sensitive lookup key for link-reference and footnote labels. */
export function normalizeRefLabel(label: string): string {
  return label.replace(/[ \t\n\f\r]+/g, ' ').replace(/^ | $/g, '')
}
