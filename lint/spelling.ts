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
  const previous = prior(line, context)
  if (text[0] === '-' && previous !== undefined && previous.text.trim() !== '' && previous.paragraph) return
  if (line.number === 1 && text === '---') return
  context.report('thematic-break-spelling', start, start + text.length, line.path, { raw: text })
}

function setextHeading(line: Line, context: LintContext): void {
  const { text, start } = contentLine(line)
  const previous = prior(line, context)
  if (previous !== undefined && previous.paragraph && previous.text.trim() !== ''
    && (isRun(text, '=', 3) || isRun(text, '-', 3))) {
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

/** A blank line, or one that holds only quote marks. */
function blank(line: Line | undefined): boolean {
  return line !== undefined && /^[\s>]*$/.test(line.text)
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
  if (text.startsWith('~~~')) return report('a tilde fence')
  if (/^:{3,}\S/.test(text)) return report('a colon fence')
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

function tableShaped(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  if (text.startsWith('|') && !text.endsWith('|') && line.paragraph) {
    context.report('table-shaped-paragraph', start, start + text.length, line.path,
      { owner: context.nodeTypes.get(line.path) === 'heading' ? 'heading' : 'paragraph' })
  }
}

function quoteWithoutSpace(line: Line, context: LintContext): void {
  const text = line.text.trimEnd()
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

function startsBlock(text: string): boolean {
  if (text.startsWith('# ') || text.startsWith('= ') || text.startsWith('> ') || text.startsWith(':: ')) return true
  if (text.startsWith(': ') || text.startsWith('{.')) return true
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
  if (text.startsWith('::')) return 2
  if (text.startsWith('[')) return text.indexOf(']:') + 2
  return 1
}

function quoteContinues(line: Line, previous: Line, context: LintContext): boolean {
  return previous.text.trimStart().startsWith('> ') && hasAncestor(line.path, context, 'block_quote')
}

function openerWithoutBlank(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (previous === undefined || !line.paragraph || previous.path !== line.path || previous.text.trim() === '') return
  const owner = context.nodeTypes.get(line.path)
  if (owner !== 'paragraph' && owner !== 'caption' && owner !== 'cell_paragraph') return
  const { text, start } = lineText(line)
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
  if (isListMarker(text)) context.report('list-marker-without-blank-line', start, start + text.length, line.path,
    {}, term ? 1 : 0)
}

function indentedCode(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (line.number > 1 && previous?.text.trim() === '' && line.paragraph && firstLineOfPath(line.path, context) === line.number
    && line.path.split('/').length <= 3 && line.text.startsWith('    ') && line.text.trim() !== '') {
    reportLine('indented-code-block', line, context)
  }
}

/** A line outside paragraph text that starts with a bracket is a link, abbreviation or citation definition. */
function isDefinitionLine(text: string): boolean {
  const start = text.trimStart()
  return start.startsWith('[') || start.startsWith('*[')
}

function unattachedCaption(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  if (!text.startsWith('^ ') || !line.paragraph) return
  if (hasAncestor(line.path, context, 'caption')) return
  const previous = prior(line, context)
  // C2-B-149: below any other block the line is text; below a definition, which is no block, it is left alone.
  if (previous !== undefined && !previous.paragraph && isDefinitionLine(previous.text)) return
  context.report('unattached-caption', start, start + text.length, line.path)
}

function unattachedAttribute(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  if (!line.paragraph || !text.startsWith('{') || !text.endsWith('}') || text.length < 3) return
  if (!attributeLead(text[1])) return
  if (context.state.attachedLines.has(line.number)) return
  const next = context.lines[line.number]
  if (next !== undefined && !blank(next) && next.paragraph === false) return
  context.report('unattached-block-attribute', start, start + text.length, line.path, {}, blank(next) ? 1 : 0)
}

function attributeLead(second: string | undefined): boolean {
  return second === '.' || second === '#' || (second !== undefined && second >= 'a' && second <= 'z')
}

function markdownDefinition(line: Line, context: LintContext): void {
  const { text, start } = lineText(line)
  const previous = prior(line, context)
  // C2-B-074: a later line of its paragraph, below a line that is no `::` term.
  if (!line.paragraph || previous === undefined || previous.path !== line.path || !text.startsWith(': ')) return
  if (lineText(previous).text.startsWith(':: ')) return
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
  const raw = trimmed(line)
  const prefix = /^(?:>\s*)+/u.exec(raw.text)?.[0] ?? ''
  const text = raw.text.slice(prefix.length)
  const start = raw.start + prefix.length
  const close = text.indexOf(']:')
  if (!line.paragraph || !text.startsWith('[') || close <= 1 || close + 2 >= text.length) return
  if (hasAncestor(line.path, context, 'footnote')) return
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
  const match = /^\s*(?:>[ \t]*)+\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/.exec(line.text)
  if (match === null || !line.paragraph) return
  const at = match[0].indexOf('[!')
  context.report('github-alert-marker', line.start + at, line.end, line.path)
}

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

function descriptionColumn(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (!line.paragraph || (!text.startsWith(': ') && !text.startsWith(':: '))) return
  if (!hasAncestor(line.path, context, 'list_item')) return
  let host: Line | undefined
  for (let at = line.number - 2; at >= 0; at--) {
    const candidate = context.lines[at]
    if (candidate === undefined) break
    if (line.number - candidate.number > 4) break
    if (trimmed(candidate).text.startsWith(':: ')) { host = candidate; break }
  }
  if (host === undefined) return
  const first = trimmed(host)
  if (!first.text.startsWith(':: ') || start - line.start >= first.start - host.start) return
  context.report('description-separator-below-content-column', start, start + text.length, line.path,
    { name: text.startsWith('::') ? 'term' : 'description', column: String(start - line.start + 1),
      'host.column': String(first.start - host.start + 1) })
}

const COLON_CONTAINER_KINDS: ReadonlySet<string> = new Set(['div', 'admonition', 'figure_group', 'line_block', 'block_quote'])

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

function colonContainers(start: number, context: LintContext): { width: number, start: number, kind: string }[] {
  const open: { width: number, start: number, kind: string }[] = []
  for (const [path, layout] of context.layouts) {
    const from = context.chars[layout.startByte] ?? 0
    const to = context.chars[layout.endByte] ?? 0
    if (from >= start || to < start - 1) continue
    const run = /^:{3,}/.exec(context.source.slice(from))?.[0]
    if (run === undefined) continue
    if (to < start && closedBeforeRun(path, layout, run.length, context)) continue
    const type = context.nodeTypes.get(path)
    if (type === undefined || !COLON_CONTAINER_KINDS.has(type)) continue
    const line = context.lines[(context.offsetLines[from] ?? 1) - 1]
    const openerText = line?.text.slice(from - line.start) ?? ''
    open.push({ width: run.length, start: from, kind: colonKind(type, openerText) })
  }
  return open.sort((a, b) => b.start - a.start)
}

function colonFenceLength(line: Line, context: LintContext): void {
  const { text, start } = contentLine(line)
  if (!/^:{3,}$/.test(text)) return
  const open = colonContainers(start, context)
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
