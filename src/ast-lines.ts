// The parts of one-line blocks that the block pass does not read: the title of an opener, the
// fields of a link definition and of an include directive.
import { type IncludeNode, type LinkReferenceDefinitionNode } from './ast.ts'
import { unescape } from './attributes.ts'
import { APOSTROPHE, BACKSLASH, PAREN_CLOSE, PAREN_OPEN, QUOTE_MARK } from './chars.ts'
import { readInclude } from './include.ts'
import { definitionDestinationEnd, definitionTailEnd, quotedEnd, skipSpaceRun } from './lines.ts'
import { type Attributes, readGluedBlocks } from './ast-attributes.ts'

/** The quoted title of a code fence, without its escapes (C2-B-120). */
export function openerTitle(src: string, start: number, end: number): string {
  return unescape(src, start, end)
}

/** C2-B-083: the link definition of `key`, with the destination and the optional quoted title behind its colon. */
export function linkDefinitionFields(
  src: string, pos: number, end: number, key: string, attributes: Attributes,
): LinkReferenceDefinitionNode {
  const start = skipSpaceRun(src, pos, end)
  const p = definitionDestinationEnd(src, start, end)
  const out: LinkReferenceDefinitionNode = { type: 'link_reference_definition', key, namespace: 'link', href: destination(src, start, p) }
  const quote = p + 1 < end ? src.charCodeAt(p + 1) : 0
  const after = quote === QUOTE_MARK || quote === APOSTROPHE ? quotedEnd(src, p + 1, end, quote) : -1
  if (after >= 0 && definitionTailEnd(src, after, end) >= 0) out.tooltip = unescape(src, p + 2, after - 1)
  // C2-B-106: the block at the end of the line merges behind the attribute lines above it, as a glued block does.
  const block = definitionTailEnd(src, out.tooltip === undefined ? p : after, end)
  if (block < end) readGluedBlocks(src, block, end, attributes)
  return out
}

/** C2-B-083: the tail line `[pos, end)` below a link definition: a title, an attribute block, or both. */
export function linkDefinitionTail(
  src: string, pos: number, end: number, out: LinkReferenceDefinitionNode, attributes: Attributes,
): void {
  const quote = src.charCodeAt(pos)
  let block = pos
  if (quote === QUOTE_MARK || quote === APOSTROPHE) {
    const after = quotedEnd(src, pos, end, quote)
    out.tooltip = unescape(src, pos + 1, after - 1)
    block = definitionTailEnd(src, after, end)
  }
  if (block < end) readGluedBlocks(src, block, end, attributes)
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
