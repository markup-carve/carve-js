// The parts of one-line blocks that the block pass does not read: the title of an opener, the
// fields of a link definition and of an include directive.
import { type IncludeNode, type LinkReferenceDefinitionNode } from './ast.ts'
import { unescape } from './attributes.ts'
import { APOSTROPHE, BACKSLASH, PAREN_CLOSE, PAREN_OPEN, QUOTE_MARK } from './chars.ts'
import { readInclude } from './include.ts'
import { definitionDestinationEnd, quotedEnd, skipSpaceRun } from './lines.ts'

/** The quoted title of a code fence, without its escapes (C2-B-120). */
export function openerTitle(src: string, start: number, end: number): string {
  return unescape(src, start, end)
}

/** C2-B-083: the link definition of `key`, with the destination and the optional quoted title behind its colon. */
export function linkDefinitionFields(src: string, pos: number, end: number, key: string): LinkReferenceDefinitionNode {
  const start = skipSpaceRun(src, pos, end)
  const p = definitionDestinationEnd(src, start, end)
  const out: LinkReferenceDefinitionNode = { type: 'link_reference_definition', key, namespace: 'link', href: destination(src, start, p) }
  const quote = p + 1 < end ? src.charCodeAt(p + 1) : 0
  if (quote !== QUOTE_MARK && quote !== APOSTROPHE) return out
  const after = quotedEnd(src, p + 1, end, quote)
  if (after >= 0) out.tooltip = unescape(src, p + 2, after - 1)
  return out
}

/** C2-I-013: a destination reads only the escaped parenthesis and the escaped backslash. */
function destination(src: string, start: number, end: number): string {
  let out = ''
  let from = start
  for (let p = start; p + 1 < end; p++) {
    if (src.charCodeAt(p) !== BACKSLASH) continue
    const next = src.charCodeAt(p + 1)
    if (next !== PAREN_OPEN && next !== PAREN_CLOSE && next !== BACKSLASH) continue
    out += src.slice(from, p)
    from = ++p
  }
  return out + src.slice(from, end)
}

/** C2-A-181: the node of the include directive on the line `[start, end)`, which the block pass found to be one. */
export function includeNode(src: string, start: number, end: number): IncludeNode {
  const parts = readInclude(src, start, end)!
  const out: IncludeNode = { type: 'include', path: parts.path }
  if (parts.section !== null) out.section = parts.section
  if (Object.keys(parts.options).length > 0) out.options = parts.options
  if (parts.invalid.length > 0) out.invalid = parts.invalid
  return out
}
