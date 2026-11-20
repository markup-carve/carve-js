import { columnOf } from '../src/layout-lines.ts'
import { isAttributeLine } from '../src/lines.ts'
import { type NodeLayout } from '../src/layout.ts'
import { type Line, type LintContext, type Rule } from './types.ts'

function trimmed(line: Line): { text: string, start: number } {
  let at = 0
  while (line.text[at] === ' ' || line.text[at] === '\t') at++
  return { text: line.text.slice(at).trimEnd(), start: line.start + at }
}

function contentLine(line: Line): { text: string, start: number } {
  let { text, start } = trimmed(line)
  while (text.startsWith('> ')) {
    text = text.slice(2).trimStart()
    start = line.start + line.text.indexOf(text, start - line.start)
  }
  return { text, start }
}

/** The text of the line behind its container prefixes: quote marks, list and description markers, indentation. */
function lineText(line: Line): { text: string, start: number } {
  if (line.content === undefined || line.content < line.start || line.content > line.end) return contentLine(line)
  return { text: line.text.slice(line.content - line.start).trimEnd(), start: line.content }
}

function isRun(text: string, chars: string, minimum: number): boolean {
  if (text.length < minimum || !chars.includes(text[0] ?? '\0')) return false
  const char = text[0]
  for (let at = 1; at < text.length; at++) if (text[at] !== char) return false
  return true
}

function isSpacedRun(text: string): boolean {
  const marker = text[0]
  if (marker === undefined || !'*-_'.includes(marker)) return false
  let count = 0
  let spaced = false
  for (let at = 0; at < text.length; at++) {
    const ch = text[at]
    if (ch === marker) count++
    else if (ch === ' ' || ch === '\t') spaced = true
    else return false
  }
  return count >= 3 && spaced
}

function prior(line: Line, context: LintContext): Line | undefined {
  return context.lines[line.number - 2]
}

function priorParagraph(line: Line, context: LintContext): boolean {
  const previous = prior(line, context)
  return previous !== undefined && previous.text.trim() !== '' && previous.paragraphLeaf
}

function hasAncestor(path: string, context: LintContext, type: string): boolean {
  let current = path
  while (current !== '') {
    const split = current.lastIndexOf('/children/')
    if (split < 0) return false
    current = current.slice(0, split)
    if (context.nodeTypes.get(current) === type) return true
  }
  return false
}

function firstLineOfPath(path: string, context: LintContext): number | undefined {
  const byte = context.layouts.get(path)?.startByte
  if (byte === undefined) return undefined
  return context.offsetLines[context.chars[byte] ?? 0]
}

function reportLine(id: Rule['id'], line: Line, context: LintContext, values?: Record<string, string>): void {
  const { text, start } = trimmed(line)
  context.report(id, start, start + text.length, line.path, values)
}

function deprecatedContinuation(line: Line, context: LintContext): void {
  const { text, start } = contentLine(line)
  const marker = text === '+' ? start : /^[-*] \+\s*$/.test(text) ? start + 2 : -1
  if (marker < 0) return
  const markerLine = /^[-*] \+\s*$/.test(text)
  const inside = hasAncestor(line.path, context, 'list_item')
  context.report('deprecated-continuation-marker', marker, marker + 1, line.path, {}, markerLine ? 2 : inside ? 1 : 0)
}

function thematicBreak(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  if (!isRun(text, '-_', 3)) return
  if (text[0] === '-' && priorParagraph(line, context)) return
  if (line.number === 1 && start === line.start && text === '---') return
  context.report('thematic-break-spelling', start, start + text.length, line.path, { raw: text })
}

function setextHeading(line: Line, context: LintContext): void {
  const { text, start } = contentLine(line)
  if (priorParagraph(line, context) && (isRun(text, '=', 3) || isRun(text, '-', 3))) {
    context.report('setext-heading-underline', start, start + text.length, line.path)
  }
}

/** A spaced run parses as nested list markers, so it reaches back from the line's text over its own marker. */
function spacedText(line: Line): { text: string, start: number } {
  if (line.content === undefined) return contentLine(line)
  const own = lineText(line)
  const marker = own.text[0]
  let at = own.start - line.start
  while (at > 0 && (line.text[at - 1] === ' ' || line.text[at - 1] === '\t' || line.text[at - 1] === marker)) at--
  while (line.text[at] === ' ' || line.text[at] === '\t') at++
  return { text: line.text.slice(at).trimEnd(), start: line.start + at }
}

/**
 * C2-W-143: how `line` reads for the rules inside the quotes of `owner`: blank when only spaces and tabs follow their quote
 * marks, outside when it lacks one of them, so those quotes ended above it; a mark counts only when a space or the end of
 * the line follows it (C2-B-031).
 */
function blankness(line: Line | undefined, owner: Line, context: LintContext): 'blank' | 'outside' | 'text' {
  if (line === undefined) return 'outside'
  let depth = 0
  for (let split = owner.path.lastIndexOf('/children/'); split > 0; split = owner.path.lastIndexOf('/children/', split - 1)) {
    if (context.nodeTypes.get(owner.path.slice(0, split)) === 'block_quote') depth++
  }
  let rest = line.text.trimStart()
  for (; depth > 0 && rest[0] === '>' && (rest.length === 1 || rest[1] === ' '); depth--) rest = rest.slice(1).trimStart()
  if (depth > 0) return 'outside'
  return rest === '' ? 'blank' : 'text'
}

function spacedBreak(line: Line, context: LintContext): void {
  const { text, start } = spacedText(line)
  if (isSpacedRun(text)) context.report('deprecated-spaced-thematic-break', start, start + text.length, line.path)
}

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
function tagEnd(text: string, at: number): number {
  const after = text[at + 1]
  if (after === undefined || !((after >= 'A' && after <= 'Z') || (after >= 'a' && after <= 'z') || after === '/')) return -1
  const end = text.indexOf('>', at + 2)
  const inside = text.slice(at + 1, end)
  return end < 0 || inside.includes('://') || inside.includes('@') || inside.startsWith('/#') ? -1 : end
}

// C2-W-106: every `<` is tested, so the tag in `<<k>` is found behind the first bracket.
function bareHtml(line: Line, context: LintContext): void {
  if (!line.paragraph) return
  for (let at = line.text.indexOf('<'); at >= 0; at = line.text.indexOf('<', at + 1)) {
    if (line.text.startsWith('<!--', at)) {
      at = line.text.indexOf('-->', at + 4)
      if (at < 0) return
      continue
    }
    const end = tagEnd(line.text, at)
    if (end < 0) continue
    context.report('bare-html-tag', line.start + at, line.start + end + 1, line.path)
    return
  }
}

function emptyReference(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  const match = /^\[([^\]\n]+)\]:[ \t]*$/.exec(text)
  if (match === null || match[1]!.trim() === '' || match[1] === '^' || !line.paragraph) return
  const footnote = match[1]!.startsWith('^')
  context.report('empty-reference-definition', start, start + match[0].indexOf(':') + 1, line.path,
    { label: match[1]! }, footnote ? 1 : 0)
}

function textOwner(path: string, context: LintContext): string {
  for (let at = path; at !== ''; at = at.slice(0, at.lastIndexOf('/'))) {
    const type = context.nodeTypes.get(at)
    if (type === 'heading') return 'heading'
    if (type === 'caption') return 'caption'
    if (type === 'definition_term') return 'term'
    if (type === 'table_cell' || type === 'cell_paragraph') return 'cell'
    if (type === 'line_block' || type === 'line') return 'line-block line'
  }
  return 'paragraph'
}

function tableShaped(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  if (text.startsWith('|') && !text.endsWith('|') && line.paragraph) {
    context.report('table-shaped-paragraph', start, start + text.length, line.path,
      { owner: textOwner(line.path, context) })
  }
}

function quoteWithoutSpace(line: Line, context: LintContext): void {
  const text = line.text.replace(/[ \t]+$/u, '')
  if (!line.paragraph || !text.startsWith('>') || text.length < 2 || text[1] === ' ') return
  context.report('blockquote-marker-without-space', line.start, line.start + text.length, line.path, { text: text.slice(1) })
}

function isListMarker(text: string): boolean {
  if (text.length < 2) return false
  if ('-*'.includes(text[0] ?? '\0') && text[1] === ' ') return true
  let at = 0
  while (at < text.length && at < 9 && text[at]! >= '0' && text[at]! <= '9') at++
  return at > 0 && (text[at] === '.' || text[at] === ')') && text[at + 1] === ' '
}

// C2-B-151, C2-B-152: one to six `=` or `#` and a space.
const HEADING_MARK = /^(?:#{1,6}|={1,6}) /

function startsBlock(text: string): boolean {
  if (HEADING_MARK.test(text) || text.startsWith('> ') || text.startsWith(':: ')) return true
  // Any valid attribute line, spaced or with an id or a key (C2-B-090, carve#6197).
  if (text.startsWith(': ') || text.startsWith('{') && isAttributeLine(text, 0, text.length)) return true
  return text.startsWith('[') && text.includes(']:')
}

function openerName(text: string): string {
  if (text.startsWith('#') || text.startsWith('=')) return 'a heading'
  if (text.startsWith('>')) return 'a quote'
  if (text.startsWith('{')) return 'an attribute line'
  if (text.startsWith('::')) return 'a term'
  return text.startsWith(':') ? 'a description' : 'a definition'
}

function openerWidth(text: string): number {
  if (text.startsWith('{')) return text.length
  if (HEADING_MARK.test(text)) return text.indexOf(' ')
  if (text.startsWith('::')) return 2
  if (text.startsWith('[')) return text.indexOf(']:') + 2
  return 1
}

function quoteContinues(line: Line, previous: Line, context: LintContext): boolean {
  // A lazy line carries no mark of the quote before its content, so its own `>` is the candidate (carve#6178).
  if (line.content !== undefined && !line.text.slice(0, line.content - line.start).includes('>')) return false
  return previous.text.trimStart().startsWith('> ') && hasAncestor(line.path, context, 'block_quote')
}

function openerCandidate(line: Line, context: LintContext): { text: string, start: number } {
  // A lazy quote marker is part of the candidate even when the leaf content starts after it.
  if (line.text[0] !== '>' && line.text[0] !== ' ' && line.text[0] !== '\t') return lineText(line)
  const original = context.lines[line.number - 1] ?? line
  return original.text.trimStart().startsWith('> ') && !hasAncestor(line.path, context, 'block_quote')
    ? trimmed(original) : lineText(line)
}

function openerWithoutBlank(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (previous === undefined || !line.paragraph || previous.path !== line.path || previous.text.trim() === '') return
  const owner = context.nodeTypes.get(line.path)
  if (owner !== 'paragraph' && owner !== 'caption' && owner !== 'cell_paragraph') return
  const { text, start } = openerCandidate(line, context)
  if (!startsBlock(text)) return
  if (text.startsWith('{') && !text.endsWith('}')) return
  if (text.startsWith('[') && hasAncestor(line.path, context, 'footnote')) return
  // In a quote the mark on both lines is the quote's own; outside one it opens a quote (C2-B-019).
  if (text.startsWith('> ') && quoteContinues(line, previous, context)) return
  context.report('block-opener-without-blank-line', start, start + openerWidth(text), line.path,
    { opener: openerName(text) })
}

function listWithoutBlank(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (previous === undefined || !line.paragraph || previous.path !== line.path || previous.text.trim() === '') return
  const { text, start } = lineText(line)
  const own = context.nodeTypes.get(line.path)
  const term = own === 'definition_term' || own === 'definition_description'
    || hasAncestor(line.path, context, 'definition_term') || hasAncestor(line.path, context, 'definition_description')
  if (!line.paragraphLeaf && !term) return
  if (isListMarker(text)) context.report('list-marker-without-blank-line', start, start + text.length, line.path,
    {}, term ? 1 : 0)
}

function indentedCode(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (line.number > 1 && previous?.text.trim() === '' && line.paragraphLeaf && firstLineOfPath(line.path, context) === line.number
    && line.path.split('/').length <= 3 && line.text.startsWith('    ') && line.text.trim() !== '') {
    reportLine('indented-code-block', line, context)
  }
}

/** A line outside paragraph text that starts with a bracket is a link, abbreviation or citation definition. */
function isDefinitionLine(text: string): boolean {
  const start = text.trimStart()
  return (start.startsWith('[') && !start.startsWith('[^')) || start.startsWith('*[')
}

function unattachedCaption(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  if (!text.startsWith('^ ') || !line.paragraph) return
  if (hasAncestor(line.path, context, 'caption')) return
  const previous = prior(line, context)
  // C2-B-149: below any other block the line is text; below a definition, which is no block, it is left alone.
  if (previous !== undefined && !previous.paragraph && isDefinitionLine(previous.text)
    && !line.text.trimStart().startsWith('> ')
    && !/^\[\^[^\]]+\]:[ \t]*%%/.test(previous.text)) return
  context.report('unattached-caption', start, start + text.length, line.path)
}

function attributeHasLaterOwner(line: Line, context: LintContext): boolean {
  if (context.state.attachedLines.has(line.number)) return true
  if (context.nodeTypes.get(line.path) === 'heading' || context.nodeTypes.get(line.path) === 'definition_term') return true
  if (line.number > 1 && firstLineOfPath(line.path, context) !== line.number) return true
  const next = context.lines[line.number]
  return next !== undefined && blankness(next, line, context) === 'text' && next.paragraph === false && !context.state.containerClosers.has(next.number)
}

function unattachedAttribute(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  if (!line.paragraph || !text.startsWith('{') || !text.endsWith('}') || text.length < 3) return
  if (!isAttributeLine(text, 0, text.length)) return
  if (attributeHasLaterOwner(line, context)) return
  const next = context.lines[line.number]
  context.report('unattached-block-attribute', start, start + text.length, line.path, {}, blankness(next, line, context) === 'blank' ? 1 : 0)
}

function markdownDefinition(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  const previous = prior(line, context)
  // C2-B-074: a later line of its paragraph, below a line that is no `::` term.
  if (!line.paragraphLeaf || previous === undefined || previous.path !== line.path || !text.startsWith(': ')) return
  if (lineText(previous).text.startsWith(':: ') || belowListColumn(line, context) !== undefined) return
  context.report('markdown-definition-paragraph', start, start + text.length, line.path)
}

function emptyInclude(line: Line, context: LintContext): void {
  if (!line.paragraph) return
  for (const match of line.text.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const body = match[1]!
    if (body.trim() !== '' && !/^\s+(?:""|“”|[#@])/.test(body)) continue
    context.report('empty-include-path', line.start + match.index, line.start + match.index + match[0].length,
      line.path, { text: match[0] })
  }
}

function linkGap(line: Line, context: LintContext): void {
  if (!line.paragraph) return
  for (const match of line.text.matchAll(/\[([^\]\n]+)\][ \t]+\(([^)\n]*)\)/g)) {
    if (match[2]!.trim() === '') continue
    context.report('link-gap-before-destination', line.start + match.index, line.start + match.index + match[0].length, line.path)
  }
}

function djotPlus(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  if (line.paragraph && text.startsWith('+ ') && text.length > 2) {
    context.report('djot-plus-bullet', start, start + text.length, line.path)
  }
}

function definitionInContainer(line: Line, context: LintContext): void {
  // C2-B-081: the line's text behind every container mark, a list marker or description mark included.
  const { text, start } = quoteDepth(line.path, context) > 0 ? contentLine(line) : lineText(line)
  const close = text.indexOf(']:')
  if (!line.paragraph || !text.startsWith('[') || close <= 1 || close + 2 >= text.length) return
  if (textOwner(line.path, context) === 'heading') return
  if (hasAncestor(line.path, context, 'footnote')) return
  if (context.nodeTypes.get(line.path) === 'definition_term' && firstLineOfPath(line.path, context) !== line.number
    && line.text[0] !== ' ' && line.text[0] !== '\t') return
  if (line.text[0] !== ' ' && line.text[0] !== '\t' && line.path.split('/').length <= 3) return
  context.report('definition-in-container', start, start + close + 2, line.path)
}

function foldedTerm(line: Line, context: LintContext): void {
  if (context.nodeTypes.get(line.path) !== 'definition_term') return
  if (firstLineOfPath(line.path, context) !== line.number) return
  const { text, start } = lineText(line)
  const marker = /^::?[ \t]+/.exec(text)?.[0]
  if (marker === undefined) return
  const body = text.slice(marker.length)
  if (/^(?:>[ \t]|[-*][ \t]|[0-9]{1,9}[.)][ \t])/.test(body)) context.report('definition-term-block-folded',
    start + marker.length, start + text.length, line.path)
}

function githubAlert(line: Line, context: LintContext): void {
  const match = GITHUB_ALERT.exec(line.text)
  if (match === null || !line.paragraph) return
  const at = match[0].lastIndexOf('[!')
  context.report('github-alert-marker', line.start + at, line.end, line.path)
}

const GITHUB_ALERT = new RegExp(
  '^\\s*(?:>[ \\t]*)+'
  + '(?:(?:[-*]|[0-9]+[.)]|[A-Za-z][.)])[ \\t]*>[ \\t]*)?'
  + '(?:\\[[^\\]\\n]+\\]:[ \\t]*>[ \\t]*)?'
  + '\\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\]',
)

function djotHeadingContinuation(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (previous === undefined || !line.paragraph || line.text.trim() === '') return
  const above = lineText(previous)
  if (above.text.startsWith('# ') && lineText(line).start - line.start <= above.start - previous.start) {
    context.report('djot-heading-continuation', previous.start, line.end, line.path)
  }
}

function quoteFenceSibling(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (previous === undefined || !trimmed(line).text.startsWith('::: >') || !previous.text.trimStart().startsWith('>')) return
  reportLine('quote-fence-ends-the-quote-above', line, context)
}

function regionAsText(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (line.paragraph && /^(?:(?:\/\/|--|\/\*|<!--)[ \t]*)?#(?:end)?region(?![A-Za-z0-9_])/i.test(text)) {
    context.report('region-marker-renders-as-text', start, start + text.length, line.path)
  }
}

function captionLooking(line: Line, context: LintContext): void {
  if (!line.paragraph) return
  const { text, start } = lineText(line)
  if (!/^(?:\*?\s*(?:Caption|Table|Tabelle|Figure|Image)(?:\s+\d+)?\s*:|:\s+\S)/i.test(text)) return
  const row = (offset: number): boolean => {
    const near = context.lines[line.number - 1 + offset]
    return near !== undefined && lineText(near).text.startsWith('|')
  }
  const below = [1, 2].some(row)
  const above = [-2, -1].some((offset) => row(offset) || (context.lines[line.number - 1 + offset]?.text ?? '').includes('!['))
  if (below || above) context.report('caption-looking-paragraph', start, start + 1, line.path, {}, below ? 0 : 1)
}

function ancestorOf(path: string, context: LintContext, type: string): string | undefined {
  let current = path
  while (current !== '') {
    if (context.nodeTypes.get(current) === type) return current
    const split = current.lastIndexOf('/children/')
    if (split < 0) return undefined
    current = current.slice(0, split)
  }
  return undefined
}

function quoteDepth(path: string, context: LintContext): number {
  let depth = 0
  for (let at = path.indexOf('/children/'); at >= 0; at = path.indexOf('/children/', at + 1)) {
    if (context.nodeTypes.get(path.slice(0, at)) === 'block_quote') depth++
  }
  return depth + (context.nodeTypes.get(path) === 'block_quote' ? 1 : 0)
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

const COLON_CONTAINER_KINDS: ReadonlySet<string> = new Set(['div', 'directive', 'admonition', 'figure_group', 'line_block', 'block_quote'])
const COLON_OWNER_BARRIERS: ReadonlySet<string> = new Set(['block_quote', 'list_item', 'definition_description', 'footnote'])

function colonKind(type: string, opener: string): string {
  if (type === 'admonition') return 'admonition'
  if (type === 'figure_group') return 'figure group'
  if (type === 'line_block') return 'line block'
  if (type === 'block_quote') return 'quote fence'
  return /^:{3,}[ \t]+\\(?:[ \t]|$)/.test(opener) ? 'hard-break block' : 'div'
}

function childCoversColonRun(path: string, start: number, end: number, context: LintContext): boolean {
  for (const [childPath, child] of context.layouts) {
    if (!childPath.startsWith(`${path}/`)) continue
    const childStart = context.chars[child.startByte] ?? 0
    const childEnd = context.chars[child.endByte] ?? 0
    if (childStart <= start && childEnd >= end) return true
  }
  return false
}

/** A layout without closerRaw may still have consumed a bare run before this line (C2-L-054). */
function hasOwnEarlierCloser(path: string, layout: NodeLayout, width: number, context: LintContext): boolean {
  const from = context.chars[layout.startByte] ?? 0
  const to = context.chars[layout.endByte] ?? 0
  const firstLine = context.offsetLines[from] ?? 1
  const lastLine = context.offsetLines[Math.max(from, to - 1)] ?? firstLine
  for (let number = firstLine + 1; number <= lastLine; number++) {
    const line = context.lines[number - 1]
    if (line === undefined) break
    const { text, start } = contentLine(line)
    if (!/^:{3,}$/.test(text) || text.length < width || start + text.length > to) continue
    if (!childCoversColonRun(path, start, start + text.length, context)) return true
  }
  return false
}

function closedBeforeRun(path: string, layout: NodeLayout, width: number, context: LintContext): boolean {
  return layout.closerRaw === undefined ? hasOwnEarlierCloser(path, layout, width, context) : layout.closerRaw !== ''
}

function colonOpener(type: string, layout: NodeLayout, context: LintContext): { raw: string, start: number } | undefined {
  const from = context.chars[layout.startByte] ?? 0
  if (layout.openerRaw !== undefined) {
    const start = context.source.indexOf(layout.openerRaw, from)
    return start < 0 ? undefined : { raw: layout.openerRaw, start }
  }
  if (type !== 'figure_group') return undefined
  const to = context.chars[layout.endByte] ?? from
  const first = context.offsetLines[from] ?? 1
  const last = context.offsetLines[to] ?? first
  for (let number = first; number <= last; number++) {
    const line = context.lines[number - 1]
    if (line === undefined) break
    const candidate = contentLine(line)
    if (/^:{3,}/.test(candidate.text)) return { raw: candidate.text, start: candidate.start }
  }
  return undefined
}

function colonContainer(path: string, layout: NodeLayout, start: number, context: LintContext):
  { width: number, start: number, kind: string } | undefined {
  const type = context.nodeTypes.get(path)
  if (type === undefined || !COLON_CONTAINER_KINDS.has(type)) return undefined
  const opener = colonOpener(type, layout, context)
  const run = opener === undefined ? undefined : /^:{3,}/.exec(opener.raw)?.[0]
  if (run === undefined) return undefined
  const to = context.chars[layout.endByte] ?? 0
  if (opener!.start >= start) return undefined
  if (to < start) {
    const parent = context.layouts.get(path.slice(0, path.lastIndexOf('/children/')))
    const parentEnd = parent === undefined ? -1 : context.chars[parent.endByte] ?? -1
    if (closedBeforeRun(path, layout, run.length, context) || parentEnd < start) return undefined
  }
  return { width: run.length, start: opener!.start, kind: colonKind(type, opener!.raw) }
}

function ownerBarrier(path: string, layout: NodeLayout, start: number, end: number, context: LintContext): boolean {
  const type = context.nodeTypes.get(path)
  if (type === undefined || !COLON_OWNER_BARRIERS.has(type)) return false
  return (context.chars[layout.startByte] ?? 0) <= start && (context.chars[layout.endByte] ?? 0) >= end
}

function colonContainers(start: number, end: number, context: LintContext): { width: number, start: number, kind: string }[] {
  const open: { path: string, width: number, start: number, kind: string }[] = []
  let boundary = ''
  for (const [path, layout] of context.layouts) {
    if (path.length > boundary.length && ownerBarrier(path, layout, start, end, context)) boundary = path
    const container = colonContainer(path, layout, start, context)
    if (container !== undefined) open.push({ ...container, path })
  }
  return open.filter(({ path }) => boundary === '' || path === boundary || path.startsWith(`${boundary}/`))
    .sort((a, b) => b.start - a.start)
}

function colonFenceLength(line: Line, context: LintContext): void {
  const { text, start } = contentLine(line)
  if (line.paragraph || !/^:{3,}$/.test(text)) return
  const open = colonContainers(start, start + text.length, context)
  const opener = open[0]
  if (opener === undefined || opener.width === text.length) return
  const openedAt = context.offsetLines[opener.start] ?? 1
  const openedLine = context.lines[openedAt - 1]
  const column = opener.start - (openedLine?.start ?? opener.start) + 1
  const variant = text.length > opener.width ? 2
    : open.slice(1).some((container) => container.width <= text.length) ? 1 : 0
  context.report('colon-fence-length-mismatch', start, start + text.length, line.path,
    { authoredWidth: String(text.length), expectedWidth: String(opener.width), kind: opener.kind,
      line: String(openedAt), column: String(column) }, variant)
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
  spacedRule('deprecated-continuation-marker', deprecatedContinuation),
  spacedRule('thematic-break-spelling', thematicBreak),
  spacedRule('setext-heading-underline', setextHeading),
  spacedRule('deprecated-spaced-thematic-break', spacedBreak),
  spacedRule('block-marker-as-text', tildeFence),
  spacedRule('html-comment-renders-as-text', htmlComment),
  spacedRule('bare-html-tag', bareHtml),
  spacedRule('empty-reference-definition', emptyReference),
  spacedRule('table-shaped-paragraph', tableShaped),
  spacedRule('blockquote-marker-without-space', quoteWithoutSpace),
  spacedRule('block-opener-without-blank-line', openerWithoutBlank),
  spacedRule('list-marker-without-blank-line', listWithoutBlank),
  spacedRule('indented-code-block', indentedCode),
  spacedRule('unattached-caption', unattachedCaption),
  spacedRule('unattached-block-attribute', unattachedAttribute),
  spacedRule('markdown-definition-paragraph', markdownDefinition),
  spacedRule('empty-include-path', emptyInclude),
  spacedRule('link-gap-before-destination', linkGap),
  spacedRule('djot-plus-bullet', djotPlus),
  spacedRule('definition-in-container', definitionInContainer),
  spacedRule('definition-term-block-folded', foldedTerm),
  spacedRule('github-alert-marker', githubAlert),
  spacedRule('djot-heading-continuation', djotHeadingContinuation),
  spacedRule('quote-fence-ends-the-quote-above', quoteFenceSibling),
  spacedRule('region-marker-renders-as-text', regionAsText),
  spacedRule('caption-looking-paragraph', captionLooking),
  spacedRule('colon-fence-length-mismatch', colonFenceLength),
  spacedRule('description-separator-below-content-column', descriptionColumn),
  spacedRule('table-row-without-closing-pipe', rowWithoutPipe),
]
