// Contract 2.4: definitions. In 0.2 a definition stands at column 0 outside every container
// (C2-B-081) and the first definition of a key wins (C2-B-085).
import { ancestor } from '../blocks.ts'
import { change, type Context } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { indentOf, isBlank, lineStart, lineText } from '../source.ts'
import { emptyQuoteChain, quotePrefix } from './blank-lines.ts'
import { insideQuotes, isBlankInQuotes, isGap, quoteDepth, removeLine } from './lines.ts'

interface Span {
  first: number
  last: number
  /** The 0-based column the definition starts at on its first line. */
  column: number
}

/** Recover an indented note range when the old parser kept only its positioned body. */
function bodySpan(ctx: Context, label: string, value: Node01[]): Span | null {
  if (value.length === 0) return null
  let first = ctx.lines.count + 1
  let last = 0
  for (const node of value) {
    if (node.pos === undefined) continue
    first = Math.min(first, node.pos.startLine)
    last = Math.max(last, node.pos.endLine)
  }
  if (last === 0) return null
  const marker = /^([ \t]*)\[\^([^\]]+)\]:/u.exec(lineText(ctx.lines, first))
  if (marker === null || marker[2] !== label || marker[1]!.length === 0) return null
  return { first, last, column: marker[1]!.length }
}

function missingNoteSpans(ctx: Context, notes: unknown): Span[] {
  const bodies = ctx.doc.footnoteDefs
  if (typeof bodies !== 'object' || bodies === null) return []
  const spans: Span[] = []
  for (const [label, value] of Object.entries(bodies as Record<string, Node01[]>)) {
    if (typeof notes === 'object' && notes !== null && label in notes) continue
    if (!Array.isArray(value)) continue
    const span = bodySpan(ctx, label, value)
    if (span !== null) spans.push(span)
  }
  return spans
}

/** The lines of every definition of the document, in source order. */
function definitionSpans(ctx: Context): Span[] {
  const spans: Span[] = []
  for (const child of ctx.doc.children ?? []) {
    if ((child.type === 'link_reference_definition' || child.type === 'abbreviation_def') && child.pos !== undefined) {
      spans.push({ first: child.pos.startLine, last: child.pos.endLine, column: child.pos.startColumn - 1 })
    }
  }
  const notes = ctx.doc.footnoteDefPos
  if (typeof notes === 'object' && notes !== null) {
    for (const pos of Object.values(notes as Record<string, { startLine: number, endLine: number, startColumn: number }>)) {
      spans.push({ first: pos.startLine, last: pos.endLine, column: pos.startColumn - 1 })
    }
  }
  // The old parser sometimes retains a definition's positioned body but omits
  // its definition position, especially when a comment interrupts its body.
  spans.push(...missingNoteSpans(ctx, notes))
  spans.sort((a, b) => a.first - b.first)
  // Two definitions that open on one line, a note in the marker line of a note, are not moved.
  return spans.filter((span, index) => span.first !== spans[index - 1]?.first && span.first !== spans[index + 1]?.first)
}

/** Length of what stands before the definition on its first line: quote marks and indentation. */
function prefixLength(text: string): number {
  const marks = quotePrefix(text, quoteDepth(text)).length
  return marks + indentOf(text.slice(marks))
}

/** Whether `line` still belongs to the container a definition with `depth` marks and `indent` stands in. */
function belongs(ctx: Context, line: number, depth: number, indent: number): boolean {
  const text = lineText(ctx.lines, line)
  if (quoteDepth(text) < depth) return false
  return depth > 0 || indentOf(text) >= indent
}

/**
 * The last line of the container that holds the definition of `span`. `ends` holds the answer
 * for every later definition by its first line, so a run of definitions is read once.
 */
function containerEnd(ctx: Context, span: Span, depth: number, indent: number, ends: Map<number, number>): number {
  let end = span.last
  for (let line = span.last + 1; line <= ctx.lines.count; line++) {
    if (isBlank(lineText(ctx.lines, line))) continue
    if (!belongs(ctx, line, depth, indent)) break
    const known = ends.get(line)
    if (known !== undefined) return Math.max(end, known)
    end = line
  }
  return end
}

function withoutPrefix(ctx: Context, span: Span, cut: number): string {
  let out = ''
  for (let line = span.first; line <= span.last; line++) {
    const text = lineText(ctx.lines, line)
    out += text.slice(line === span.first ? cut : Math.min(cut, prefixLength(text))) + '\n'
  }
  return out
}

/** U-038 when the definition stands in a container, U-039 when it is only indented. */
function entryOf(ctx: Context, span: Span, depth: number): string {
  if (depth > 0) return 'U-038'
  for (let line = span.first - 1; line >= 1; line--) {
    const leaf = ctx.blocks.leaf[line]
    if (leaf === null || leaf === undefined) continue
    if (leaf.node.type === 'link_reference_definition' || leaf.node.type === 'abbreviation_def') continue
    return ancestor(leaf, 'list_item') !== null || ancestor(leaf, 'definition_list') !== null ? 'U-038' : 'U-039'
  }
  return 'U-039'
}

/**
 * The definition is the last thing in its container: its lines lose their prefix where they
 * stand, and the blank lines of the container above it lose their quote marks.
 */
function hoistInPlace(ctx: Context, id: string, span: Span, cut: number, message: string): void {
  for (let line = span.first - 1; line >= 1 && isGap(ctx, line) && isBlankInQuotes(lineText(ctx.lines, line)); line--) {
    const text = lineText(ctx.lines, line)
    if (text !== '') change(ctx, id, lineStart(ctx.lines, line), lineStart(ctx.lines, line) + text.length, '', message)
  }
  for (let line = span.first; line <= span.last; line++) {
    if (innerLines.has(line)) continue
    const start = lineStart(ctx.lines, line)
    const length = Math.min(cut, prefixLength(lineText(ctx.lines, line)))
    if (length > 0) change(ctx, id, start, start + length, '', message)
  }
}

function preserveEmptyQuote(ctx: Context, id: string, span: Span, message: string): boolean {
  const empty = (ctx.doc.children ?? []).some((node) => node.type === 'block_quote' && node.children?.length === 0
    && node.pos?.startLine === span.first && node.pos.endLine === span.last)
  if (!empty) return false
  const first = lineText(ctx.lines, span.first)
  const prefix = quotePrefix(first, quoteDepth(first)).trimEnd()
  if (prefix === '') return false
  const at = lineStart(ctx.lines, span.first)
  change(ctx, id, at, at + prefixLength(first), `${prefix}\n`, message)
  for (let line = span.first + 1; line <= span.last; line++) {
    const start = lineStart(ctx.lines, line)
    change(ctx, id, start, start + prefixLength(lineText(ctx.lines, line)), '', message)
  }
  return true
}

function preserveEmptyItem(ctx: Context, id: string, span: Span, message: string): boolean {
  const definition = (ctx.doc.children ?? []).find((node) => node.pos?.startLine === span.first
    && (node.type === 'link_reference_definition' || node.type === 'abbreviation_def'))
  if (definition?.pos === undefined) return false
  const item = ctx.visits.find((visit) => visit.node.type === 'list_item' && visit.node.children?.length === 0
    && visit.node.pos?.startLine === span.first && visit.node.pos.endLine === span.first
    && visit.node.pos.endOffset <= definition.pos!.startOffset && visit.siblings.length === 1)
  if (item?.node.pos === undefined) return false
  const start = lineStart(ctx.lines, span.first)
  const marker = ctx.src.slice(start, item.node.pos.endOffset)
  const first = lineText(ctx.lines, span.first).slice(definition.pos.startOffset - start)
  let definitionText = first + '\n'
  for (let line = span.first + 1; line <= span.last; line++) {
    const text = lineText(ctx.lines, line)
    definitionText += text.slice(prefixLength(text)) + '\n'
  }
  change(ctx, id, start, lineStart(ctx.lines, span.last + 1), `${marker}{% %}\n\n${definitionText}`, message)
  return true
}

/** Cuts the definition of `span` and writes it at column 0 above the first line of the document. */
function moveToTop(ctx: Context, id: string, span: Span, cut: number, message: string): void {
  const at = lineStart(ctx.lines, span.first)
  // An empty braced comment keeps the block 0.1 opened for the definition (C2-I-025).
  const kept = top === 'kept' ? lineText(ctx.lines, span.first).slice(0, cut) + '{%%}\n' : ''
  const end = lineStart(ctx.lines, span.last + 1)
  // An earlier edit inside the cut lines would win the conflict and leave them in place; the moved copy
  // is written from the source, so the edit gives way instead.
  ctx.findings = ctx.findings.filter(({ edit }) => edit === null || edit.start <= at || edit.start >= end || edit.end > end)
  change(ctx, id, at, end, kept, message)
  change(ctx, id, 0, 0, withoutPrefix(ctx, span, cut) + '\n', message)
}

/** Cuts the definition of `span` and writes it at column 0 after the line `end`, set off by blank lines. */
function moveAfter(ctx: Context, id: string, span: Span, cut: number, end: number, message: string, keep = ''): void {
  if (top === 'moved' || top === 'kept') { moveToTop(ctx, id, span, cut, message); return }
  const kept = top === 'keptAfter' && cut > 0 ? lineText(ctx.lines, span.first).slice(0, cut) + '{%%}\n' : keep
  change(ctx, id, lineStart(ctx.lines, span.first), lineStart(ctx.lines, span.last + 1), kept, message)
  const after = lineText(ctx.lines, end + 1)
  const tail = end < ctx.lines.count && !isBlank(after) ? '\n' : ''
  const at = lineStart(ctx.lines, end + 1)
  const lead = at > 0 && ctx.src.charCodeAt(at - 1) !== 0x0a ? '\n\n' : '\n'
  change(ctx, id, at, at, lead + withoutPrefix(ctx, span, cut) + tail, message)
}

/** What goes before the definition on its first line. A late form reads the column off the tree, which also counts a list marker. */
function cutOf(text: string, span: Span): number {
  const prefix = prefixLength(text)
  return top !== false && span.column > prefix ? span.column : prefix
}

/** U-038, U-039: the definition moves to column 0, after the container it stood in. */
function hoist(ctx: Context, span: Span, ends: Map<number, number>): void {
  const text = lineText(ctx.lines, span.first)
  const cut = cutOf(text, span)
  const depth = quoteDepth(text)
  const shape = insideQuotes(text).trimStart()
  if (shape.startsWith('[') && !shape.startsWith('[^') && shape.endsWith(']:')) return
  const message = 'definition moved to column 0 outside its container'
  const block = ctx.blocks.within[span.first]!
  if (block > span.last) {
    // U-005 when the block is a paragraph of the document: 0.2 would read the line as its text.
    moveAfter(ctx, cut === 0 && ctx.blocks.leaf[span.first]?.parent?.node === ctx.doc ? 'U-005' : 'U-038', span, cut, block, message)
    return
  }
  if (cut === 0) return
  const id = entryOf(ctx, span, depth)
  const end = Math.max(containerEnd(ctx, span, depth, cut, ends), enclosing.get(span)?.last ?? 0)
  ends.set(span.first, end)
  place(ctx, id, span, cut, end, message)
}

/** Writes the definition of `span` after the line `end` of its container. */
function place(ctx: Context, id: string, span: Span, cut: number, end: number, message: string): void {
  const quote = top === false && ctx.repairs === true ? emptyNestedQuote(ctx, span) : ''
  if (quote !== '') {
    moveAfter(ctx, id, span, cut, end, message, quote)
    const next = span.last + 1
    const outerEndsHere = (ctx.doc.children ?? []).some((node) => node.type === 'block_quote'
      && node.pos?.endLine === span.last && node.pos.startLine <= span.first)
    if (outerEndsHere && next <= ctx.lines.count && /^>[ \t]*$/u.test(lineText(ctx.lines, next))) {
      change(ctx, id, lineStart(ctx.lines, next), lineStart(ctx.lines, next + 1), '',
        'unclaimed empty quote line removed after the definition was moved')
    }
  }
  else if (end === span.last) hoistLast(ctx, id, span, cut, message)
  else moveAfter(ctx, id, span, cut, end, message)
}

/**
 * The quote marks that keep the empty quote 0.1 opened for a definition inside another quote, with a
 * quoted blank line above them where text stands there, or 0.2 reads the marks as a lazy line.
 */
function emptyNestedQuote(ctx: Context, span: Span): string {
  const first = lineText(ctx.lines, span.first)
  const depth = quoteDepth(first)
  if (depth < 2) return ''
  const chain = emptyQuoteChain(ctx, span.first)
  if (chain === 0) return ''
  const marks = quotePrefix(first, depth).trimEnd()
  const above = span.first > 1 && !isBlankInQuotes(lineText(ctx.lines, span.first - 1))
  return (above ? quotePrefix(first, depth - chain).trimEnd() + '\n' : '') + marks + '\n'
}

/** The definition is the last thing in its container. */
function hoistLast(ctx: Context, id: string, span: Span, cut: number, message: string): void {
  if (top === 'moved' || top === 'kept') moveToTop(ctx, id, span, cut, message)
  else if (top === 'keptAfter') moveAfter(ctx, id, span, cut, span.last, message)
  else if (!preserveEmptyItem(ctx, id, span, message) && !preserveEmptyQuote(ctx, id, span, message)) {
    hoistInPlace(ctx, id, span, cut, message)
  }
}

/** U-040, U-041: 0.1 took the last definition of a key, so every earlier one is removed. */
function duplicates(ctx: Context, type: string, key: string, id: string): void {
  const last = new Map<string, Node01>()
  const nodes = (ctx.doc.children ?? []).filter((child) => child.type === type && child.pos !== undefined)
  for (const node of nodes) last.set(String(node[key]), node)
  for (const node of nodes) {
    if (last.get(String(node[key])) === node) continue
    for (let line = node.pos!.startLine; line <= node.pos!.endLine; line++) {
      removeLine(ctx, id, line, 'earlier definition of the key removed: 0.1 took the last, 0.2 takes the first')
    }
  }
}

/** The label of a link definition line that 0.1 dropped for a later one, or null. */
function droppedLabel(ctx: Context, line: number): string | null {
  const text = insideQuotes(lineText(ctx.lines, line)).trimStart()
  const close = text.indexOf(']: ')
  return isGap(ctx, line) && text.startsWith('[') && !text.startsWith('[^') && close > 1 ? text.slice(1, close) : null
}

/** U-040: the 0.1 tree keeps only the last link definition of a key, so the earlier ones are read off their lines. */
function droppedLinkDefinitions(ctx: Context): void {
  const labels = new Set<string>()
  for (const child of ctx.doc.children ?? []) {
    if (child.type === 'link_reference_definition') labels.add(String(child.label))
  }
  if (labels.size === 0) return
  for (let line = 1; line <= ctx.lines.count; line++) {
    const label = droppedLabel(ctx, line)
    if (label !== null && labels.has(label)) {
      removeLine(ctx, 'U-040', line, 'earlier definition of the key removed: 0.1 took the last, 0.2 takes the first')
    }
  }
}

/** Set while `definitionsNested` runs. */
let nested = false
/** The definition whose lines hold a span, read off the 0.1 positions; and every line of such an inner span. */
const enclosing = new Map<Span, Span>()
const innerLines = new Set<number>()

function markNested(spans: Span[]): void {
  for (const span of spans) {
    const outer = spans.find((other) => other !== span && other.first < span.first && other.last >= span.last)
    if (outer === undefined) continue
    enclosing.set(span, outer)
    for (let line = span.first; line <= span.last; line++) innerLines.add(line)
  }
}

/**
 * C2-B-081: a definition that 0.1 read inside the body of another definition moves out after that whole
 * body, so the body lines below it stay with the definition that owned them in 0.1.
 */
export function definitionsNested(ctx: Context): void {
  nested = true
  try { definitions(ctx) } finally {
    nested = false
    enclosing.clear()
    innerLines.clear()
  }
}

/**
 * Set while a late variant runs: a moved definition goes above the document instead of after its
 * container, and with `kept` an empty comment stays in its place.
 */
let top: false | 'moved' | 'kept' | 'keptAfter' = false

/**
 * U-042: 0.1 and 0.2 both keep the first definition of a note key. A later one in a container left no
 * block in 0.1, but 0.2 reads it as text there, so the late passes remove it; quote marks before it stay.
 */
const NOTE_LINE = /^\[\^[^\]]+\]: /u
const DROPPED = 'a later definition of the note key, which 0.1 dropped, is removed'

/** Below a definition that moves out, the marks would open a quote of their own, unless 0.1 wrote that quote empty. */
function belowMovedNote(ctx: Context, line: number): boolean {
  return line > 1 && NOTE_LINE.test(insideQuotes(lineText(ctx.lines, line - 1)).trimStart())
    && !ctx.visits.some(({ node }) => node.type === 'block_quote' && (node.children?.length ?? 0) === 0
      && node.pos !== undefined && node.pos.startLine <= line - 1 && node.pos.endLine >= line - 1)
}

/** Its lazy lines went with the dropped definition in 0.1: no block of the tree holds them. Returns the last line removed. */
function dropLazyLines(ctx: Context, line: number): number {
  while (line < ctx.lines.count && isGap(ctx, line + 1) && !isBlank(lineText(ctx.lines, line + 1))
    && !/^\[\^?[^\]]+\]: /u.test(insideQuotes(lineText(ctx.lines, line + 1)).trimStart())) {
    removeLine(ctx, 'U-042', ++line, 'a lazy line of the dropped note definition is removed')
  }
  return line
}

function droppedNoteDefinitions(ctx: Context): void {
  const keys = ctx.doc.footnoteDefs
  if (typeof keys !== 'object' || keys === null) return
  const notes = ctx.doc.footnoteDefPos as Record<string, { startLine: number }> | undefined
  const kept = new Set(Object.values(notes ?? {}).map((pos) => pos.startLine))
  for (let line = 1; line <= ctx.lines.count; line++) {
    const text = lineText(ctx.lines, line)
    const marks = quotePrefix(text, quoteDepth(text)).trimEnd()
    const label = /^\[\^([^\]]+)\]: /u.exec(insideQuotes(text).trimStart())?.[1]
    if (label === undefined || kept.has(line) || !isGap(ctx, line) || !(label in keys) || prefixLength(text) === 0) continue
    const start = lineStart(ctx.lines, line)
    if (marks === '' || belowMovedNote(ctx, line)) removeLine(ctx, 'U-042', line, DROPPED)
    else change(ctx, 'U-042', start, start + text.length, marks, DROPPED)
    line = dropLazyLines(ctx, line)
  }
}

export function definitions(ctx: Context): void {
  const spans = definitionSpans(ctx)
  enclosing.clear()
  innerLines.clear()
  if (nested) markNested(spans)
  const ends = new Map<number, number>()
  for (let index = spans.length - 1; index >= 0; index--) hoist(ctx, spans[index]!, ends)
  droppedLinkDefinitions(ctx)
  if (ctx.late) droppedNoteDefinitions(ctx)
  duplicates(ctx, 'abbreviation_def', 'abbr', 'U-041')
}

/**
 * The late variant of `definitions`: after its container a definition can land in a block 0.2 leaves
 * open to the end, such as an unclosed fence; above the first line it stands in no block (C2-B-081).
 */
export function definitionsAtTop(ctx: Context): void {
  top = 'moved'
  try { definitions(ctx) } finally { top = false }
}

/** `definitionsAtTop`, leaving an empty braced comment where the definition stood. */
export function definitionsKept(ctx: Context): void {
  top = 'kept'
  try { definitions(ctx) } finally { top = false }
}

/** `definitions`, leaving an empty braced comment where the definition stood, so its container stays open. */
export function definitionsKeptAfter(ctx: Context): void {
  top = 'keptAfter'
  try { definitions(ctx) } finally { top = false }
}
