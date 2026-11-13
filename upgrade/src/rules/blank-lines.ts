// Contract 2.1, and U-033, U-106 and U-107: in 0.2 only six line shapes end a paragraph without a
// blank line (C2-B-013 to C2-B-019, C2-B-200), so a block 0.1 opened directly under text gets one.
import { ancestor, isInside, quotesOf } from '../blocks.ts'
import { change, type Context, type Visit } from '../context.ts'
import { indentOf, lineStart, lineText } from '../source.ts'

const GT = 0x3e
const DEFINITIONS = new Set(['link_reference_definition', 'abbreviation_def'])
const BLOCK_LEAVES = new Set([
  'paragraph', 'heading', 'code_block', 'raw_block', 'table', 'thematic_break', 'link_reference_definition',
  'abbreviation_def', 'comment', 'line_block', 'math_block', 'block_quote', 'image',
])

type Above = 'paragraph' | 'term' | 'caption'

export function isTerm(visit: Visit): boolean {
  return visit.parent !== null && visit.parent.node.type === 'definition_list' && !BLOCK_LEAVES.has(visit.node.type)
}

/** What kind of text ends on `line`, if the leaf there takes lazy lines in 0.2. */
function textAbove(ctx: Context, line: number): Above | null {
  const leaf = ctx.blocks.leaf[line]
  if (leaf === null || leaf === undefined) return null
  if (leaf.node.type === 'paragraph') return 'paragraph'
  if (isTerm(leaf)) return 'term'
  if (leaf.parent!.node.type.startsWith('figure') && !BLOCK_LEAVES.has(leaf.node.type)) return 'caption'
  const caption = leaf.node.caption
  // C2-B-148: a caption is paragraph-like.
  return Array.isArray(caption) && caption.length > 0 && leaf.node.pos!.endLine === line ? 'caption' : null
}

/** The container of the type `type` that opens on `line` and holds `below` but not `above`. */
function opensAt(below: Visit, above: Visit, type: string, line: number): Visit | null {
  for (let at = ancestor(below, type); at !== null; at = ancestor(at, type)) {
    if (at.node.pos!.startLine === line && !isInside(above, at)) return at
  }
  return null
}

function footnoteStarts(ctx: Context): Set<number> {
  const starts = new Set<number>()
  const places = ctx.doc.footnoteDefPos
  if (typeof places !== 'object' || places === null) return starts
  for (const pos of Object.values(places as Record<string, { startLine: number }>)) starts.add(pos.startLine)
  return starts
}

/** The entry for a list that opens under text: only where 0.2 has no interrupter for it. */
function listEntry(below: Visit, above: Visit, line: number): string | null {
  if (opensAt(below, above, 'list', line) === null) return null
  const quote = ancestor(above, 'block_quote')
  // C2-B-020: a marker without the quote mark does not interrupt the list in the quote.
  if (quote !== null && !isInside(below, quote) && ancestor(above, 'list_item') !== null) return 'U-007'
  const descriptions = ancestor(above, 'definition_list')
  // C2-B-022: a description list is not a list for the marker interrupter.
  if (descriptions !== null && !isInside(below, descriptions)) return 'U-008'
  // The text of a footnote body takes a marker as a lazy line in the same way.
  return above.parent!.parent === null && above.siblings !== below.siblings && ancestor(below, 'list')?.parent?.parent === null ? 'U-008' : null
}

function underItem(above: Visit, below: Visit, plain: string, inItem: string): string {
  const item = ancestor(above, 'list_item')
  if (item === null) return plain
  return inItem === 'U-006' && isInside(below, item) ? plain : inItem
}

/** Whether a quote written with `>` opens on `line` between the two leaves. */
function quoteOpens(ctx: Context, above: Visit, below: Visit, line: number): boolean {
  const quote = opensAt(below, above, 'block_quote', line)
  if (quote === null || quote.node.fenced === true) return false
  const text = lineText(ctx.lines, line)
  return text.charCodeAt(indentOf(text)) === GT || quotesOf(above).length > 0
}

/** The entry for a block that 0.1 opened directly under paragraph text and 0.2 reads as a lazy line. */
function blockEntry(ctx: Context, above: Visit, below: Visit, line: number, notes: Set<number>): string | null {
  const term = isTerm(below)
  if (below.node.type === 'heading') return underItem(above, below, 'U-001', 'U-006')
  // A definition in the middle of a block of the document is moved out whole (U-038), not set off.
  if (DEFINITIONS.has(below.node.type) || notes.has(line)) return ctx.blocks.within[line]! > line ? null : 'U-005'
  if (term) return isInside(above, below.parent!) ? null : underItem(above, below, 'U-004', 'U-009')
  if (quoteOpens(ctx, above, below, line)) return underItem(above, below, 'U-002', 'U-006')
  return listEntry(below, above, line)
}

/** The entry that puts a blank line between `above` and the block `below` that starts on `line`. */
function entryFor(ctx: Context, kind: Above, above: Visit, below: Visit, line: number, notes: Set<number>): string | null {
  const plain = below.node.type === 'paragraph' && !notes.has(line)
  if (kind === 'caption') {
    // U-107: a second caret line continues the caption (C2-B-148); any other text 0.1 folded too.
    if (plain) return ctx.src[below.node.pos!.startOffset] === '^' && opensAt(below, above, 'list_item', line) === null ? 'U-107' : null
    return blockEntry(ctx, above, below, line, notes) === null ? null : 'U-010'
  }
  if (kind !== 'term') return blockEntry(ctx, above, below, line, notes)
  if (isTerm(below) || isInside(below, above.parent!)) return null
  // U-106: a term continues like paragraph text (C2-B-069), so text that 0.1 put after the list needs the blank line.
  return plain || blockEntry(ctx, above, below, line, notes) !== null || opensAt(below, above, 'list', line) !== null ? 'U-106' : null
}

/** The start of `text` through its `count`-th quote mark: what a blank line inside those quotes holds. */
export function quotePrefix(text: string, count: number): string {
  let seen = 0
  for (let at = 0; at < text.length && seen < count; at++) {
    const code = text.charCodeAt(at)
    if (code === GT) {
      seen++
      if (seen === count) return text.slice(0, at + 1)
    } else if (code !== 0x20 && code !== 0x09) break
  }
  return ''
}

function sharedQuotes(above: Visit, below: Visit): number {
  let shared = 0
  for (const quote of quotesOf(above)) {
    if (isInside(below, quote)) shared++
  }
  return shared
}

export function isAttributeLine(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 2 && trimmed.startsWith('{') && trimmed.endsWith('}') && !trimmed.startsWith('{{') && !trimmed.startsWith('{%')
}

/** U-003, U-033: an attribute line is no leaf of the 0.1 tree, so it is read off the line. */
function attributeLine(ctx: Context, above: Visit, line: number): void {
  const text = lineText(ctx.lines, line)
  const prefix = quotePrefix(text, quotesOf(above).length)
  const inner = text.slice(prefix.length).trimStart()
  // A gap line that starts with a brace is an attribute block, also when it wraps (U-032).
  if (!inner.startsWith('{') || inner.startsWith('{{') || inner.startsWith('{%') || inner.length < 3) return
  const entry = ancestor(above, 'list_item') === null ? 'U-003' : 'U-033'
  const at = lineStart(ctx.lines, line)
  change(ctx, entry, at, at, prefix + '\n', 'blank line put above the attribute line, which 0.2 reads as text directly under text')
}

export function blankLines(ctx: Context): void {
  const notes = footnoteStarts(ctx)
  for (let line = 2; line <= ctx.lines.count; line++) {
    const kind = textAbove(ctx, line - 1)
    if (kind === null) continue
    const above = ctx.blocks.leaf[line - 1]!
    const below = ctx.blocks.leaf[line]
    if (below === null || below === undefined) {
      attributeLine(ctx, above, line)
      continue
    }
    if (below === above || below.node.pos!.startLine !== line) continue
    const entry = entryFor(ctx, kind, above, below, line, notes)
    if (entry === null) continue
    const prefix = quotePrefix(lineText(ctx.lines, line), sharedQuotes(above, below))
    const at = lineStart(ctx.lines, line)
    change(ctx, entry, at, at, prefix + '\n', 'blank line put above a block that 0.2 reads as a lazy line directly under text')
  }
}
