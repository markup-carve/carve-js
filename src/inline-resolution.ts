import type { Abbreviation, Attrs, InlineNode, Position, Text } from './ast.js'
import { mapInlineChildren } from './inline-children.js'
import { isUnresolvedReference } from './unresolved-reference.js'
import { applyReferenceDefinition } from './reference-resolution.js'

export interface LinkDef {
  /** Label spelling carried by the winning definition for canonical output. */
  rawLabel?: string
  /**
   * Zero-based index of the line the definition was written on. Kept so PART 12
   * §10's node can carry a `pos` and so the hoisted definitions come out in
   * SOURCE order rather than map order (carve-js#690).
   */
  line?: number
  href: string
  title?: string
  attrs?: Attrs
}

/**
 * A span covering `value.slice(start, end)` of a text node whose own span is
 * `parent`.
 *
 * Abbreviation expansion splits a text node AFTER parsing, so the fragments it
 * produces have no span of their own - and PART 12 section 4 requires one on
 * every node except the document root.
 *
 * The arithmetic is sound rather than approximate: a text node's value maps 1:1
 * onto its source span, because escapes, smart punctuation and soft breaks are
 * each their own node, so no source character inside a text run stands for a
 * different number of characters. A text node never contains a newline either,
 * so a fragment stays on the parent's line and the column math stays flat.
 *
 * Returns undefined when the parent carries no span, rather than inventing one:
 * section 4 forbids emitting `pos` with invented values.
 */
function fragmentPos(
  parent: Position | undefined,
  start: number,
  end: number,
): Position | undefined {
  if (!parent) return undefined
  const pos: Position = { startLine: parent.startLine, endLine: parent.startLine }
  if (parent.startColumn !== undefined) {
    pos.startColumn = parent.startColumn + start
    pos.endColumn = parent.startColumn + end
  }
  if (parent.startOffset !== undefined) {
    pos.startOffset = parent.startOffset + start
    pos.endOffset = parent.startOffset + end
  }
  return pos
}


export function applyAbbreviations(
  nodes: InlineNode[],
  defs: Map<string, string>,
): InlineNode[] {
  if (defs.size === 0) return nodes
  const out: InlineNode[] = []
  const abbrRe = new RegExp(`\\b(${[...defs.keys()].join('|')})\\b`, 'g')
  for (const node of nodes) {
    if (node.type !== 'text') {
      mapInlineChildren(node, applyAbbreviations, defs)
      out.push(node)
      continue
    }
    const value = node.value
    let last = 0
    abbrRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = abbrRe.exec(value))) {
      if (m.index > last) {
        const frag = { type: 'text', value: value.slice(last, m.index) } as Text
        const fragSpan = fragmentPos(node.pos, last, m.index)
        if (fragSpan) frag.pos = fragSpan
        out.push(frag)
      }
      const abbr = m[1]!
      out.push({
        type: 'abbreviation',
        abbr,
        expansion: defs.get(abbr)!,
        pos: fragmentPos(node.pos, m.index, m.index + abbr.length),
      } as Abbreviation)
      last = m.index + abbr.length
    }
    if (last < value.length) {
      out.push({
        type: 'text',
        value: value.slice(last),
        pos: fragmentPos(node.pos, last, value.length),
      } as Text)
    } else if (last === 0) {
      out.push(node)
    }
  }
  return out
}

/**
 * Resolve reference-link placeholders against the collected definitions.
 * A resolved ref becomes a normal Link; an unresolved one falls back to
 * its literal `[text][ref]` text (Djot behavior). Order-independent: the
 * definition may appear anywhere in the document (grammar §6).
 */
export function applyLinkDefs(
  nodes: InlineNode[],
  defs: Map<string, LinkDef>,
): InlineNode[] {
  const out: InlineNode[] = []
  for (let node of nodes) {
    mapInlineChildren(node, applyLinkDefs, defs)
    if (isUnresolvedReference(node)) {
      node = applyReferenceDefinition(node, defs)
      // Unresolved links remain available to the later heading-reference pass.
    }
    out.push(node)
  }
  return out
}

