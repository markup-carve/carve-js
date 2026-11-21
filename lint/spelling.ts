import { columnOf } from '../src/layout-lines.ts'
import { isAttributeLine } from '../src/lines.ts'
import { type Line, type LintContext, type Rule } from './types.ts'
import { ancestorOf, quoteDepth } from './ancestry.ts'

function trimmed(line: Line): { text: string, start: number } {
  let at = 0
  while (line.text[at] === ' ' || line.text[at] === '\t') at++
  return { text: line.text.slice(at).trimEnd(), start: line.start + at }
}

const SPACE = /\s/

function contentLine(line: Line): { text: string, start: number } {
  const { text, start } = trimmed(line)
  // An offset instead of a slice and a search of the rest per quote mark, which made a run of `> ` quadratic.
  let at = 0
  while (text.startsWith('> ', at)) {
    at += 2
    while (at < text.length && SPACE.test(text[at]!)) at++
  }
  return { text: text.slice(at), start: start + at }
}

/** The text of the line behind its container prefixes: quote marks, list and description markers, indentation. */
function lineText(line: Line): { text: string, start: number } {
  if (line.content === undefined || line.content < line.start || line.content > line.end) return contentLine(line)
  return { text: line.text.slice(line.content - line.start).trimEnd(), start: line.content }
}

function prior(line: Line, context: LintContext): Line | undefined {
  return context.lines[line.number - 2]
}

function firstLineOfPath(path: string, context: LintContext): number | undefined {
  const byte = context.layouts.get(path)?.startByte
  if (byte === undefined) return undefined
  return context.offsetLines[context.chars[byte] ?? 0]
}

/** A spaced run parses as nested list markers, so it reaches back from the line's text over its own marker. */

/**
 * C2-W-143: how `line` reads for the rules inside the quotes of `owner`: blank when only spaces and tabs follow their quote
 * marks, outside when it lacks one of them, so those quotes ended above it; a mark counts only when a space or the end of
 * the line follows it (C2-B-031).
 */

/** The characters that open an attribute block after its brace: a class, an id or a key. */
function opensAttributes(code: number): boolean {
  return code === 46 || code === 35 || code === 95 || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function tildeFence(line: Line, context: LintContext): void {
  if (!line.paragraph) return
  const layoutStart = context.layouts.get(line.path)?.startByte
  const first = layoutStart === undefined ? undefined : context.chars[layoutStart]
  const candidate = first !== undefined && first >= line.start && first < line.end
    ? { text: line.text.slice(first - line.start).trimEnd(), start: first }
    : contentLine(line)
  const { text, start } = candidate
  const report = (what: string): void => context.report('block-marker-as-text', start, start + text.length, line.path, { what })
  const firstText = firstLineOfPath(line.path, context) === line.number
  if (text.startsWith('~~~') && firstText) return report('a tilde fence')
  if (/^:{3,}\S/.test(text) && firstText) return report('a colon fence')
  // C2-B-090: a brace run that opened a braced inline form is no attribute line that failed.
  if (text.startsWith('{') && opensAttributes(text.charCodeAt(1)) && !isAttributeLine(text, 0, text.length)
    && !context.state.spanStarts.has(start)) {
    report('an attribute line')
  }
}

function htmlComment(line: Line, context: LintContext): void {
  const at = line.text.indexOf('<!--')
  if (at < 0 || !line.paragraph) return
  const end = line.text.indexOf('-->', at + 4)
  if (end < 0) return
  context.report('html-comment-renders-as-text', line.start + at, line.start + end + 3, line.path)
}

/** The end of the tag-shaped text at `at`, or -1: a `<` before a letter or `/`, up to the next `>`. */

// C2-W-106: every `<` is tested, so the tag in `<<k>` is found behind the first bracket.

// C2-B-151, C2-B-152: one to six `=` or `#` and a space.

/** A line outside paragraph text that starts with a bracket is a link, abbreviation or citation definition. */

function markdownDefinition(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  const previous = prior(line, context)
  // C2-B-074: a later line of its paragraph, below a line that is no `::` term.
  if (!line.paragraphLeaf || previous === undefined || previous.path !== line.path || !text.startsWith(': ')) return
  if (lineText(previous).text.startsWith(':: ') || belowListColumn(line, context) !== undefined) return
  context.report('markdown-definition-paragraph', start, start + text.length, line.path)
}

function regionAsText(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (line.paragraph && /^(?:(?:\/\/|--|\/\*|<!--)[ \t]*)?#(?:end)?region(?![A-Za-z0-9_])/i.test(text)) {
    context.report('region-marker-renders-as-text', start, start + text.length, line.path)
  }
}

// C2-B-067, C2-B-071, C2-B-074: a colon mark that opens no entry, below a description list whose first term
// mark stands further right.
function opensEntry(line: Line, context: LintContext): boolean {
  if (context.nodeTypes.get(line.path) === 'definition_term' && firstLineOfPath(line.path, context) === line.number) return true
  const description = ancestorOf(line.path, context, 'definition_description')
  return description !== undefined && firstLineOfPath(description, context) === line.number
}

/** The column of the first term mark of the description list the nearest non-blank line above at the same quote depth lies in. */
function listColumnAbove(line: Line, context: LintContext): number | undefined {
  const depth = quoteDepth(line.path, context)
  for (let at = line.number - 2; at >= 0; at--) {
    const host = context.lines[at]
    if (host === undefined || host.text.trim() === '' || quoteDepth(host.path, context) !== depth) continue
    const list = ancestorOf(host.path, context, 'definition_list')
    const listStart = list === undefined ? undefined : context.layouts.get(list)?.startByte
    if (list === undefined || listStart === undefined) return undefined
    return columnOf(context.source, context.chars[listStart] ?? 0, quoteDepth(list, context))
  }
  return undefined
}

interface BelowColumn { text: string, start: number, column: number, hostColumn: number }

function belowListColumn(line: Line, context: LintContext): BelowColumn | undefined {
  // A quote-shaped lazy line outside a quote starts with `>`, not with the colon behind it.
  if (quoteDepth(line.path, context) === 0 && line.text.trimStart().startsWith('>')) return undefined
  if (context.state.descriptionStarts.has(line.number)) return undefined
  const { text, start } = contentLine(line)
  if (!/^::?(?:[ \t]|$)/.test(text) || opensEntry(line, context)) return undefined
  const hostColumn = listColumnAbove(line, context)
  // C2-B-004: columns count tab stops.
  const column = columnOf(context.source, start, quoteDepth(line.path, context))
  return hostColumn !== undefined && hostColumn > column ? { text, start, column, hostColumn } : undefined
}

function descriptionColumn(line: Line, context: LintContext): void {
  const found = belowListColumn(line, context)
  if (found === undefined) return
  const { text, start, column, hostColumn } = found
  context.report('description-separator-below-content-column', start, start + text.length, line.path,
    { name: text.startsWith('::') ? 'term' : 'description', column: String(column + 1), 'host.column': String(hostColumn + 1) })
}

function rowWithoutPipe(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  if (line.paragraph && text.startsWith('|') && text.includes('|') && !text.endsWith('|')) {
    context.report('table-row-without-closing-pipe', start, start + text.length, line.path)
  }
}

function spacedRule(id: Rule['id'], checkLine: (line: Line, context: LintContext) => void): Rule {
  return { id, lines: true, checkLine }
}

export const LINE_RULES: readonly Rule[] = [
  spacedRule('block-marker-as-text', tildeFence),
  spacedRule('html-comment-renders-as-text', htmlComment),
  spacedRule('markdown-definition-paragraph', markdownDefinition),
  spacedRule('region-marker-renders-as-text', regionAsText),
  spacedRule('description-separator-below-content-column', descriptionColumn),
  spacedRule('table-row-without-closing-pipe', rowWithoutPipe),
]
