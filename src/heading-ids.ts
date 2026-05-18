/*
 * Heading identifier generation + cross-reference resolution.
 *
 * Behavior is fixed by markup-carve/carve PR #1 ("Automatic Identifiers").
 * slugify is pure and context-free; dedup lives in resolveHeadingIds.
 */

/** The 9-step automatic-identifier rule. Pure, context-free, no dedup. */
export function slugify(plainText: string): string {
  let s = plainText.toLowerCase()
  s = s.trim()
  s = s.replace(/['";:]/gu, '')
  s = s.replace(/[^\p{L}\p{N}_-]+/gu, '-')
  s = s.replace(/-{2,}/gu, '-')
  s = s.replace(/^-+|-+$/gu, '')
  if (/^\p{N}/u.test(s)) s = `section-${s}`
  if (s === '') s = 'section'
  return s
}
