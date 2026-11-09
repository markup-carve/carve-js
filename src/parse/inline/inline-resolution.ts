import type { Abbreviation, Attrs, InlineNode, Position, Text } from '../../ast.js'
import { mapInlineChildren } from './inline-children.js'
import { isUnresolvedReference } from './unresolved-reference.js'
import { applyReferenceDefinition } from './reference-resolution.js'

export interface LinkDef {
  /** Label spelling carried by the winning definition for canonical output. */
  rawLabel?: string
  /** Columns between the line start and the definition, on a note's opening line. */
  lead?: number
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


const WORD_CHAR = /[\p{L}\p{N}]/u

function scalarAt(value: string, index: number): string | undefined {
  const point = value.codePointAt(index)
  return point === undefined ? undefined : String.fromCodePoint(point)
}

function scalarBefore(value: string, index: number): string | undefined {
  if (index === 0) return undefined
  const low = value.charCodeAt(index - 1)
  const start = low >= 0xdc00 && low <= 0xdfff && index > 1 ? index - 2 : index - 1
  return scalarAt(value, start)
}

/** An eligible inline edge contributes its rendered character to R3. */
function edgeWord(node: InlineNode, side: 'first' | 'last'): boolean | undefined {
  if (node.type === 'comment') return undefined
  if (node.type === 'text' || node.type === 'escaped_text') {
    const char = side === 'first' ? scalarAt(node.value, 0) : scalarBefore(node.value, node.value.length)
    return char === undefined ? undefined : WORD_CHAR.test(char)
  }
  if (node.type === 'emphasis' || node.type === 'strong' || node.type === 'underline' ||
      node.type === 'strike' || node.type === 'superscript' || node.type === 'subscript' ||
      node.type === 'highlight' || node.type === 'link' || node.type === 'span' ||
      node.type === 'small_caps' || node.type === 'insert' || node.type === 'delete' ||
      node.type === 'inline_extension') {
    const children = node.type === 'inline_extension' ? node.content : node.children
    const order = side === 'first' ? children : [...children].reverse()
    for (const child of order) {
      const word = edgeWord(child, side)
      if (word !== undefined) return word
    }
    return undefined
  }
  return false
}

function expandAbbreviations(nodes: InlineNode[], defs: Map<string, string>, left: boolean, right: boolean): InlineNode[] {
  if (defs.size === 0) return nodes
  const out: InlineNode[] = []
  // PART 9R R3 reads adjacent rendered characters, including across eligible
  // inline element edges. Compute each sibling's outside neighbors once.
  const before: boolean[] = []
  const after: boolean[] = []
  let word = left
  for (let i = 0; i < nodes.length; i++) {
    before[i] = word
    word = edgeWord(nodes[i]!, 'last') ?? word
  }
  word = right
  for (let i = nodes.length - 1; i >= 0; i--) {
    after[i] = word
    word = edgeWord(nodes[i]!, 'first') ?? word
  }
  const abbrRe = new RegExp(`(?<![\\p{L}\\p{N}])(${[...defs.keys()].join('|')})(?![\\p{L}\\p{N}])`, 'gu')
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!
    if (node.type !== 'text') {
      const transparent = node.type === 'emphasis' || node.type === 'strong' ||
        node.type === 'underline' || node.type === 'strike' || node.type === 'superscript' ||
        node.type === 'subscript' || node.type === 'highlight' || node.type === 'link' ||
        node.type === 'span' || node.type === 'small_caps' || node.type === 'insert' ||
        node.type === 'delete' || node.type === 'inline_extension'
      mapInlineChildren(node, children => expandAbbreviations(children, defs,
        transparent ? before[index]! : false, transparent ? after[index]! : false), undefined)
      out.push(node)
      continue
    }
    const value = node.value
    let last = 0
    abbrRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = abbrRe.exec(value))) {
      const preceding = m.index === 0 ? before[index]! : WORD_CHAR.test(scalarBefore(value, m.index)!)
      const following = m.index + m[0].length === value.length ? after[index]! : WORD_CHAR.test(scalarAt(value, m.index + m[0].length)!)
      if (preceding || following) continue
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

export function applyAbbreviations(nodes: InlineNode[], defs: Map<string, string>): InlineNode[] {
  return expandAbbreviations(nodes, defs, false, false)
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
  if (defs.size === 0) return nodes
  for (const node of nodes) {
    mapInlineChildren(node, applyLinkDefs, defs)
    if (isUnresolvedReference(node)) {
      applyReferenceDefinition(node, defs)
      // Unresolved links remain available to the later heading-reference pass.
    }
  }
  return nodes
}
