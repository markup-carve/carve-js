// Contract 2.3: attribute lines, and what follows a fence language or a div name.
import { change, type Context, note, type Visit } from '../context.ts'
import { type Node01 } from '../engines.ts'
import { indentOf, isBlank, lineEnd, lineStart, lineText } from '../source.ts'
import { insideQuotes, isAttributeGap, isBlankInQuotes, isGap, removeLine } from './lines.ts'

/** The first line after `line` that is not blank, or 0 at the end of the text. */
function nextText(ctx: Context, line: number): number {
  for (let at = line + 1; at <= ctx.lines.count; at++) {
    if (!isBlankInQuotes(lineText(ctx.lines, at))) return at
  }
  return 0
}

/**
 * U-031, U-034: an attribute line that no block takes is a paragraph in 0.2 (C2-B-092), so the
 * blank lines between it and its block go, and a line that reaches no block goes itself.
 */
function detached(ctx: Context, line: number): void {
  if (!isBlankInQuotes(lineText(ctx.lines, line + 1)) && line < ctx.lines.count) return
  const next = nextText(ctx, line)
  if (next === 0) {
    let first = line
    while (first > 1 && isGap(ctx, first - 1) && isBlank(lineText(ctx.lines, first - 1))) first--
    for (let at = first; at <= ctx.lines.count; at++) removeLine(ctx, 'U-034', at, 'attribute line that reaches no block removed')
    return
  }
  if (isGap(ctx, next) && !isAttributeGap(ctx, next)) return
  for (let at = line + 1; at < next; at++) removeLine(ctx, 'U-031', at, 'blank line between the attribute line and its block removed')
}

/** U-032: a valid attribute block is all on one line (C2-I-028). */
function wrapped(ctx: Context, line: number): number {
  const text = insideQuotes(lineText(ctx.lines, line)).trim()
  if (!isGap(ctx, line) || !text.startsWith('{') || text.startsWith('{{') || text.startsWith('{%') || text.endsWith('}')) return line
  let last = line + 1
  while (isGap(ctx, last) && !lineText(ctx.lines, last).trimEnd().endsWith('}') && !isBlank(lineText(ctx.lines, last))) last++
  if (!isGap(ctx, last) || isBlank(lineText(ctx.lines, last))) return line
  for (let at = line; at < last; at++) {
    const next = lineStart(ctx.lines, at + 1)
    change(ctx, 'U-032', lineEnd(ctx.lines, at), next + indentOf(lineText(ctx.lines, at + 1)), ' ', 'attribute block joined onto one line')
  }
  return last
}

export function attributeLines(ctx: Context): void {
  for (let line = 1; line <= ctx.lines.count; line++) {
    if (isAttributeGap(ctx, line)) detached(ctx, line)
    else line = wrapped(ctx, line)
  }
}

const OPENER_HOSTS = new Set(['code_block', 'admonition', 'div'])

function isFenceCode(code: number): boolean {
  return code === 0x60 || code === 0x7e || code === 0x3a
}

/** Offset after the fence run and the word that follows it on the opener line of `node`, or -1. */
function afterName(ctx: Context, node: Node01): number {
  const line = node.pos!.startLine
  let at = node.pos!.startOffset
  const end = lineEnd(ctx.lines, line)
  while (at < end && !isFenceCode(ctx.src.charCodeAt(at))) at++
  const fence = at
  while (at < end && ctx.src.charCodeAt(at) === ctx.src.charCodeAt(fence)) at++
  if (at - fence < 3) return -1
  while (at < end && ctx.src.charCodeAt(at) === 0x20) at++
  const name = at
  while (at < end && ctx.src.charCodeAt(at) > 0x20 && ctx.src[at] !== '{') at++
  return at > name ? at : -1
}

/**
 * U-037, U-051: 0.1 dropped an attribute block or unquoted words after a fence language or a
 * div name; 0.2 reports them (C2-B-105, C2-B-122), so they are removed.
 */
function openerTail(ctx: Context, node: Node01): void {
  if (node.label !== undefined || node.header !== undefined || node.title !== undefined || node.attrs !== undefined) return
  const at = afterName(ctx, node)
  const end = lineEnd(ctx.lines, node.pos!.startLine)
  if (at < 0) return
  const rest = ctx.src.slice(at, end).trim()
  if (rest === '' || rest.startsWith('"')) return
  if (rest.startsWith('{')) change(ctx, 'U-037', at, end, '', 'attribute block after the fence language or div name removed, as 0.1 dropped it')
  else change(ctx, 'U-051', at, end, '', 'unquoted words after the fence language or div name removed, as 0.1 dropped them')
}

function rank(name: string): number {
  if (name.startsWith('#')) return 0
  return name.startsWith('.') ? 1 : 2
}

/** Whether the authored order of the attributes of `node` is not the order 0.2 writes (C2-H-009). */
function isReordered(node: Node01): boolean {
  const order = node.attrs?.order
  if (!Array.isArray(order)) return false
  let highest = 0
  for (const name of order as unknown[]) {
    const at = typeof name === 'string' ? rank(name) : 2
    if (at < highest) return true
    highest = at
  }
  return false
}

export function openers(ctx: Context): void {
  let reordered: Visit | null = null
  for (const visit of ctx.visits) {
    if (visit.node.pos === undefined) continue
    if (OPENER_HOSTS.has(visit.node.type)) openerTail(ctx, visit.node)
    if (reordered === null && isReordered(visit.node)) reordered = visit
  }
  // U-036: once per file.
  if (reordered !== null) note(ctx, 'U-036', reordered.node.pos!.startLine, 'attributes are written in the order id, classes, keys in 0.2, not as authored')
}
