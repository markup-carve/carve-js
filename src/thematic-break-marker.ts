export function thematicBreakSpelling(
  authored: '-' | '*' | '_' | undefined,
  override: string | null,
): string {
  return override ?? (authored ?? '-').repeat(3)
}
