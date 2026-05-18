/*
 * Heading identifier generation + cross-reference resolution.
 *
 * Behavior is fixed by markup-carve/carve PR #1 ("Automatic Identifiers").
 * slugify is pure and context-free; dedup lives in resolveHeadingIds.
 */

import type { InlineNode } from './ast.js'

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

/** Visible plain text of an inline run (markup stripped). */
export function inlineText(nodes: InlineNode[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
      case 'code':
        out += n.value
        break
      case 'italic':
      case 'strong':
      case 'underline':
      case 'strike':
      case 'super':
      case 'sub':
      case 'highlight':
      case 'bold-italic':
      case 'link':
      case 'critic-insert':
      case 'critic-delete':
      case 'critic-highlight':
        out += inlineText(n.children)
        break
      case 'extension':
        out += inlineText(n.content)
        break
      case 'critic-substitute':
        out += n.newText
        break
      case 'abbreviation':
        out += n.abbr
        break
      case 'mention':
        out += n.user
        break
      case 'tag':
        out += n.name
        break
      case 'soft-break':
      case 'hard-break':
        out += ' '
        break
      // image, autolink, footnote, crossref, critic-comment: no slug text
      default:
        break
    }
  }
  return out
}
