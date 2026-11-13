// Contract 2.4: definitions. In 0.2 a definition stands at column 0 outside every container
// (C2-B-081) and the first definition of a key wins (C2-B-085).
import { ancestor } from '../blocks.ts'
import { change, type Context } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { indentOf, isBlank, lineStart, lineText } from '../source.ts'
import { quotePrefix } from './blank-lines.ts'
import { isBlankInQuotes, isGap, quoteDepth, removeLine } from './lines.ts'

interface Span {
  first: number
  last: number
}

/** The lines of every definition of the document, in source order. */
function definitionSpans(ctx: Context): Span[] {
  const spans: Span[] = []
  for (const child of ctx.doc.children ?? []) {
    if ((child.type === 'link_reference_definition' || child.type === 'abbreviation_def') && child.pos !== undefined) {
      spans.push({ first: child.pos.startLine, last: child.pos.endLine })
    }
  }
  const notes = ctx.doc.footnoteDefPos
  if (typeof notes === 'object' && notes !== null) {
    for (const pos of Object.values(notes as Record<string, { startLine: number, endLine: number }>)) {
      spans.push({ first: pos.startLine, last: pos.endLine })
    }
  }
  return spans.sort((a, b) => a.first - b.first)
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

/** The last line of the container that holds the definition of `span`. */
function containerEnd(ctx: Context, span: Span, depth: number, indent: number): number {
  let end = span.last
  for (let line = span.last + 1; line <= ctx.lines.count; line++) {
    if (isBlank(lineText(ctx.lines, line))) continue
    if (!belongs(ctx, line, depth, indent)) break
    end = line
  }
  return end
}

function withoutPrefix(ctx: Context, span: Span, cut: number): string {
  let out = ''
  for (let line = span.first; line <= span.last; line++) {
    const text = lineText(ctx.lines, line)
    out += text.slice(Math.min(cut, prefixLength(text))) + '\n'
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
    const start = lineStart(ctx.lines, line)
    const length = Math.min(cut, prefixLength(lineText(ctx.lines, line)))
    if (length > 0) change(ctx, id, start, start + length, '', message)
  }
}

/** U-038, U-039: the definition moves to column 0, after the container it stood in. */
function hoist(ctx: Context, span: Span): void {
  const text = lineText(ctx.lines, span.first)
  const cut = prefixLength(text)
  if (cut === 0) return
  const depth = quoteDepth(text)
  const id = entryOf(ctx, span, depth)
  const message = 'definition moved to column 0 outside its container'
  const end = containerEnd(ctx, span, depth, cut)
  if (end === span.last) {
    hoistInPlace(ctx, id, span, cut, message)
    return
  }
  change(ctx, id, lineStart(ctx.lines, span.first), lineStart(ctx.lines, span.last + 1), '', message)
  const after = lineText(ctx.lines, end + 1)
  const tail = end < ctx.lines.count && !isBlank(after) ? '\n' : ''
  const at = lineStart(ctx.lines, end + 1)
  const lead = at > 0 && ctx.src.charCodeAt(at - 1) !== 0x0a ? '\n\n' : '\n'
  change(ctx, id, at, at, lead + withoutPrefix(ctx, span, cut) + tail, message)
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
  const text = lineText(ctx.lines, line)
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

export function definitions(ctx: Context): void {
  for (const span of definitionSpans(ctx)) hoist(ctx, span)
  droppedLinkDefinitions(ctx)
  duplicates(ctx, 'abbreviation_def', 'abbr', 'U-041')
}
