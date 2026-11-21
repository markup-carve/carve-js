// Helpers for rules that work on whole lines of the source.
import { change, type Context } from '../context.ts'
import { indentOf, isBlank, lineEnd, lineStart, lineText } from '../source.ts'
import { isAttributeLine, quotePrefix } from './blank-lines.ts'

/** Whether no leaf block holds `line`. */
export function isGap(ctx: Context, line: number): boolean {
  return line >= 1 && line <= ctx.lines.count && (ctx.blocks.leaf[line] ?? null) === null
}

/** Number of quote marks that lead `text`. */
export function quoteDepth(text: string): number {
  let depth = 0
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code === 0x3e) depth++
    else if (code !== 0x20 && code !== 0x09) break
  }
  return depth
}

/** `text` without the quote marks that lead it. */
export function insideQuotes(text: string): string {
  return text.slice(quotePrefix(text, quoteDepth(text)).length)
}

export function isBlankInQuotes(text: string): boolean {
  return isBlank(insideQuotes(text))
}

/** Whether `line` is a gap line that holds an attribute block and nothing else. */
export function isAttributeGap(ctx: Context, line: number): boolean {
  return isGap(ctx, line) && isAttributeLine(insideQuotes(lineText(ctx.lines, line)))
}

/** Removes the whole of `line`, its line ending included. */
export function removeLine(ctx: Context, id: string, line: number, message: string): void {
  change(ctx, id, lineStart(ctx.lines, line), lineStart(ctx.lines, line + 1), '', message)
}

/** Length of the first `depth` quote marks of `text` and the indentation after them. */
export function bodyOffset(text: string, depth: number): number {
  const marks = quotePrefix(text, depth).length
  return marks + indentOf(text.slice(marks))
}

/**
 * Puts `count` spaces before the content of every line of `first` to `last` that is not blank.
 * The content starts after the `depth` quote marks of the container the lines stand in.
 */
export function indentLines(ctx: Context, id: string, first: number, last: number, count: number, message: string, depth = 0): void {
  if (count <= 0) return
  for (let line = first; line <= last; line++) {
    const text = lineText(ctx.lines, line)
    const marks = quotePrefix(text, depth).length
    if (isBlank(text.slice(marks))) continue
    const at = lineStart(ctx.lines, line) + (marks > 0 && text[marks] === ' ' ? marks + 1 : marks)
    change(ctx, id, at, at, ' '.repeat(count), message)
  }
}

/** Removes `count` leading spaces of every line of `first` to `last` that has them. */
export function dedentLines(ctx: Context, id: string, first: number, last: number, count: number, message: string): void {
  for (let line = first; line <= last; line++) {
    const text = lineText(ctx.lines, line)
    const cut = Math.min(count, indentOf(text))
    if (cut > 0 && !isBlank(text)) change(ctx, id, lineStart(ctx.lines, line), lineStart(ctx.lines, line) + cut, '', message)
  }
}

interface Token {
  start: number
  end: number
}

/** The tokens of the attribute block `text`, split at spaces outside quotes. */
function attributeTokens(text: string, open: number, close: number): Token[] {
  const tokens: Token[] = []
  let start = -1
  let quoted = false
  for (let at = open + 1; at <= close; at++) {
    const code = text.charCodeAt(at)
    if (code === 0x22) quoted = !quoted
    const space = at === close || (!quoted && (code === 0x20 || code === 0x09))
    if (!space && start < 0) start = at
    if (space && start >= 0) {
      tokens.push({ start, end: at })
      start = -1
    }
  }
  return tokens
}

/**
 * Removes from the attribute line `line` every token `drop` names. A line left with no token
 * goes whole. Returns whether a token was found.
 */
export function removeAttribute(ctx: Context, id: string, line: number, drop: (token: string) => boolean, message: string): boolean {
  const text = lineText(ctx.lines, line)
  const open = text.indexOf('{')
  const close = text.lastIndexOf('}')
  const tokens = attributeTokens(text, open, close)
  const hits = tokens.filter((token) => drop(text.slice(token.start, token.end)))
  if (hits.length === 0) return false
  if (hits.length === tokens.length) {
    removeLine(ctx, id, line, message)
    return true
  }
  const base = lineStart(ctx.lines, line)
  for (const hit of hits) {
    // The space before the token goes with it, or the space after it when it is the first.
    const first = hit.start === open + 1
    change(ctx, id, base + (first ? hit.start : hit.start - 1), base + (first ? hit.end + 1 : hit.end), '', message)
  }
  return true
}

/** The attribute lines that stand directly above `line`, nearest first. */
export function attributeLinesAbove(ctx: Context, line: number): number[] {
  const found: number[] = []
  for (let at = line - 1; at >= 1 && isAttributeGap(ctx, at); at--) found.push(at)
  return found
}

/** Offset of the end of `line` without trailing spaces. */
export function trimmedEnd(ctx: Context, line: number): number {
  let end = lineEnd(ctx.lines, line)
  const start = lineStart(ctx.lines, line)
  while (end > start && (ctx.src.charCodeAt(end - 1) === 0x20 || ctx.src.charCodeAt(end - 1) === 0x09)) end--
  return end
}
