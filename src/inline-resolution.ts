import { resolveReferenceDestination } from './reference-state.js'
import type { Abbreviation, Attrs, InlineNode, Position, Text } from './ast.js'
import { mergeAttrs } from './attribute-merge.js'
import { mapInlineChildren } from './inline-children.js'
import { isUnresolvedReference } from './unresolved-reference.js'
import { normalizeRefLabel } from './label-key.js'

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
    if (node.type === 'link' && isUnresolvedReference(node)) {
      // Normalization does not make a multiline label syntactically valid.
      // The inline scanner may retain such a bracket run as a placeholder so
      // it can degrade byte-for-byte, but it must never enter the symbol table.
      const def = /[\r\n]/.test(node.ref) ? undefined : defs.get(normalizeRefLabel(node.ref))
      if (def) {
        node = resolveReferenceDestination(node, def.href)
        if (def.title !== undefined) node.title = def.title
        // PART 9R R1: the definition's attributes transfer to the link, and
        // the link's own override per key. "Per key" is §15 A3's merge - the
        // one stacked attribute lists already use - so a repeated id or key
        // takes the LAST value (the link's) and classes ACCUMULATE across the
        // two. Definition first, link second (carve#604).
        if (def.attrs) node.attrs = mergeAttrs(def.attrs, node.attrs ?? {})
      }
        // PART 12 §3a, A RESOLVED REFERENCE KEEPS ITS DESTINATION: `ref` and
        // `rawRef` stay BESIDE `href`, exactly as §5 has footnote numbering
        // added alongside rather than in place of the reference. Deleting them
        // made `[a][]` and `[a](#a)` the same tree, which is the distinction
        // the clause exists to protect - and the clause names all three
        // engines as missing this half (carve#596).

      // If unresolved, KEEP the placeholder so a post-parse pass
      // (resolveImplicitHeadingRefs in heading-ids.ts) can match it
      // against the document's parsed headings, or finalize it to
      // literal text. Falling back here would lose the link node
      // before that pass ever sees it.
      out.push(node)
      continue
    }
    if (node.type === 'image' && isUnresolvedReference(node)) {
      const def = /[\r\n]/.test(node.ref) ? undefined : defs.get(normalizeRefLabel(node.ref))
      if (def) {
        node = resolveReferenceDestination(node, def.href)
        if (def.title !== undefined) node.title = def.title
        // AN IMAGE REFERENCE RESOLVES THE SAME ENTRY - NORMATIVE. It looks the
        // label up in the same table and takes the same three fields, so a
        // definition's attributes reach the image exactly as they reach a link:
        // `[ex]: /i.png {.wide}` gives `class="wide"`. This took `href` and
        // `title` and stopped, which is not a rule, it is where the
        // implementation stopped (carve#697).
        //
        // Same §15 A3 merge as the link branch above - definition first, use
        // site second, so a repeated key takes the LAST value and classes
        // ACCUMULATE in source order.
        if (def.attrs) node.attrs = mergeAttrs(def.attrs, node.attrs ?? {})
      }
        // PART 12 §3a, A RESOLVED REFERENCE KEEPS ITS DESTINATION: `ref` and
        // `rawRef` stay BESIDE `href`, exactly as §5 has footnote numbering
        // added alongside rather than in place of the reference. Deleting them
        // made `[a][]` and `[a](#a)` the same tree, which is the distinction
        // the clause exists to protect - and the clause names all three
        // engines as missing this half (carve#596).

      // Unresolved image refs do NOT match heading text; the resolve pass
      // finalizes any survivor to literal source (rawRef).
      out.push(node)
      continue
    }
    out.push(node)
  }
  return out
}

