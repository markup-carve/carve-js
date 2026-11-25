// C2-B-234: a caption or a term holds only the lines directly below it that are indented past its marker.
import { change, type Context } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { lineOf, lineStart, lineText } from '../source.ts'

const TAB = 0x09
const SPACE = 0x20
const GT = 0x3e

function column(text: string): number {
  let at = 0
  for (let i = 0; i < text.length; i++) at = text.charCodeAt(i) === TAB ? (at + 4) & ~3 : at + 1
  return at
}

function quoteMarks(text: string): number {
  let count = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === GT) count++
  return count
}

/** The line breaks of the inline content `inlines`, at any depth. */
function breaksOf(inlines: Node01[]): Node01[] {
  const found: Node01[] = []
  const stack = [...inlines].reverse()
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.type === 'soft_break' || node.type === 'hard_break') {
      found.push(node)
      continue
    }
    const children = node.children
    if (Array.isArray(children)) for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as Node01)
  }
  return found
}

/** U-442: a line 0.1 joined to the caption `caption` moves past its caret. */
function captionLines(ctx: Context, caption: Node01[]): void {
  const first = caption[0]?.pos
  if (first === undefined) return
  const markerStart = lineStart(ctx.lines, first.startLine)
  const lead = ctx.src.slice(markerStart, first.startOffset)
  const caret = lead.lastIndexOf('^')
  if (caret < 0) return
  // C2-W-024: the continuation line stands at the column of the caption text; quote marks stay.
  const prefix = lead.replace(/[^>\t]/gu, ' ')
  const caretColumn = column(lead.slice(0, caret))
  for (const node of breaksOf(caption)) {
    if (node.pos === undefined) continue
    let at = node.pos.endOffset
    const line = lineOf(ctx.lines, at)
    // A hard break at the end of the caption ends no line of it.
    if (line === lineOf(ctx.lines, node.pos.startOffset)) continue
    const start = lineStart(ctx.lines, line)
    while (ctx.src.charCodeAt(at) === SPACE || ctx.src.charCodeAt(at) === TAB) at++
    const own = ctx.src.slice(start, at)
    if (own === prefix || column(own) > caretColumn && quoteMarks(own) === quoteMarks(prefix)) continue
    change(ctx, 'U-442', start, at, prefix, 'line that 0.1 joined to the caption indented past its caret')
  }
}

/** The column of the `::` before the first term text of `item`, or -1. */
function termColumn(ctx: Context, item: Node01): number {
  const terms = item.terms as Node01[][] | undefined
  const pos = terms?.[0]?.[0]?.pos
  if (pos === undefined) return -1
  const start = lineStart(ctx.lines, pos.startLine)
  const lead = ctx.src.slice(start, pos.startOffset)
  const mark = /::[ \t]*$/u.exec(lead)
  return mark === null ? -1 : mark.index
}

function descriptionMarks(ctx: Context, list: Node01): void {
  for (const item of (list.items ?? []) as Node01[]) {
    const term = termColumn(ctx, item)
    if (term < 0) continue
    const termLead = lineText(ctx.lines, (item.terms as Node01[][])[0]![0]!.pos!.startLine).slice(0, term)
    for (const line of (item.definitionLines ?? []) as number[]) {
      const text = lineText(ctx.lines, line)
      if (!text.startsWith(termLead)) continue
      const mark = /^ +:(?=[ \t]|$)/u.exec(text.slice(term))
      if (mark === null) continue
      const start = lineStart(ctx.lines, line) + term
      change(ctx, 'U-180', start, start + mark[0].length - 1, '',
        'description mark that 0.1 read below its term moved to the term column')
    }
  }
}

export function captionContinuation(ctx: Context): void {
  for (const { node } of ctx.visits) {
    if (Array.isArray(node.caption) && node.caption.length > 0) captionLines(ctx, node.caption as Node01[])
  }
}

/**
 * U-180: a description mark 0.1 read below its term, right of the term mark, moves to the term column.
 * A late variant, since the first pass moves the term mark instead where that keeps the 0.1 HTML.
 */
export function termDescriptionMarks(ctx: Context): void {
  for (const { node } of ctx.visits) if (node.type === 'definition_list') descriptionMarks(ctx, node)
}
