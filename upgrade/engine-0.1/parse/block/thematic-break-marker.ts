export function thematicBreakSpelling(
  authored: '-' | '*' | '_' | undefined,
  override: string | null,
): string {
  return override ?? (authored ?? '-').repeat(3)
}

/**
 * The spelling a break takes when `---` at byte 0 would be read as a
 * frontmatter opener. PART 11 section 1a respells every break in the document,
 * which is the smallest departure that keeps `to_html(fmt(x)) == to_html(x)`.
 */
export const FRONTMATTER_SAFE_BREAK = '***'
