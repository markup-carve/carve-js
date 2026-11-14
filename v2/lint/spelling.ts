import { type Line, type LintContext, type Rule } from './types.ts'

function trimmed(line: Line): { text: string, start: number } {
  let at = 0
  while (line.text[at] === ' ' || line.text[at] === '\t') at++
  return { text: line.text.slice(at).trimEnd(), start: line.start + at }
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
  if (trimmed(line).text === '+') reportLine('deprecated-continuation-marker', line, context)
}

function thematicBreak(line: Line, context: LintContext): void {
  const text = trimmed(line).text
  if (!isRun(text, '-_', 3)) return
  const previous = prior(line, context)
  if (text[0] === '-' && previous !== undefined && previous.text.trim() !== '' && previous.paragraph) return
  reportLine('thematic-break-spelling', line, context, { raw: text })
}

function setextHeading(line: Line, context: LintContext): void {
  const text = trimmed(line).text
  const previous = prior(line, context)
  if (isRun(text, '-', 3) && previous !== undefined && previous.paragraph && previous.text.trim() !== '') {
    reportLine('setext-heading-underline', line, context)
  }
}

function spacedBreak(line: Line, context: LintContext): void {
  if (isSpacedRun(trimmed(line).text)) reportLine('deprecated-spaced-thematic-break', line, context)
}

function tildeFence(line: Line, context: LintContext): void {
  const text = trimmed(line).text
  if (text.startsWith('~~~') && line.paragraph) reportLine('block-marker-as-text', line, context, { what: 'a tilde fence' })
}

function htmlComment(line: Line, context: LintContext): void {
  const at = line.text.indexOf('<!--')
  if (at < 0 || !line.paragraph) return
  const end = line.text.indexOf('-->', at + 4)
  if (end < 0) return
  context.report('html-comment-renders-as-text', line.start + at, line.start + end + 3, line.path)
}

function bareHtml(line: Line, context: LintContext): void {
  if (!line.paragraph) return
  const at = line.text.indexOf('<')
  if (at < 0 || line.text.startsWith('<!--', at)) return
  const after = line.text[at + 1]
  if (after === undefined || !((after >= 'A' && after <= 'Z') || (after >= 'a' && after <= 'z') || after === '/')) return
  const end = line.text.indexOf('>', at + 2)
  const inside = line.text.slice(at + 1, end)
  if (inside.includes('://') || inside.includes('@') || inside.startsWith('/#')) return
  if (end > at) context.report('bare-html-tag', line.start + at, line.start + end + 1, line.path)
}

function emptyReference(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (!text.startsWith('[') || !text.endsWith(']:') || text.length < 4) return
  if (text.indexOf(']') !== text.length - 2) return
  context.report('empty-reference-definition', start, start + text.length, line.path)
}

function tableShaped(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (text.startsWith('|') && !text.endsWith('|') && line.paragraph) {
    context.report('table-shaped-paragraph', start, start + text.length, line.path)
  }
}

function quoteWithoutSpace(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (!text.startsWith('>') || text.length < 2 || text[1] === ' ' || text[1] === '\t') return
  context.report('blockquote-marker-without-space', start, start + text.length, line.path, { text: text.slice(1) })
}

function isListMarker(text: string): boolean {
  if (text.length < 2) return false
  if ('-*+'.includes(text[0] ?? '\0') && text[1] === ' ') return true
  let at = 0
  while (at < text.length && at < 9 && text[at]! >= '0' && text[at]! <= '9') at++
  return at > 0 && (text[at] === '.' || text[at] === ')') && text[at + 1] === ' '
}

function startsBlock(text: string): boolean {
  if (text.startsWith('# ') || text.startsWith('= ') || text.startsWith('> ') || text.startsWith(':: ')) return true
  if (text.startsWith(': ') || text.startsWith('{.')) return true
  return text.startsWith('[') && text.includes(']:')
}

function openerWithoutBlank(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (previous === undefined || !line.paragraph || previous.path !== line.path || previous.text.trim() === '') return
  const { text, start } = trimmed(line)
  if (!startsBlock(text)) return
  if (text.startsWith('{') && !text.endsWith('}')) return
  if (text.startsWith('[') && hasAncestor(line.path, context, 'footnote')) return
  if (text.startsWith('> ') && previous.text.trimStart().startsWith('> ')) return
  context.report('block-opener-without-blank-line', start, start + text.length, line.path)
}

function listWithoutBlank(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (previous === undefined || !line.paragraph || previous.path !== line.path || previous.text.trim() === '') return
  if (isListMarker(trimmed(line).text)) reportLine('list-marker-without-blank-line', line, context)
}

function indentedCode(line: Line, context: LintContext): void {
  if (line.paragraph && line.path.split('/').length <= 3 && line.text.startsWith('    ') && line.text.trim() !== '') {
    reportLine('indented-code-block', line, context)
  }
}

function unattachedCaption(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (!text.startsWith('^ ') || !line.paragraph) return
  if (hasAncestor(line.path, context, 'caption')) return
  const previous = prior(line, context)
  if (previous !== undefined && previous.text.trim() !== '' && !previous.paragraph) return
  context.report('unattached-caption', start, start + text.length, line.path)
}

function unattachedAttribute(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (!line.paragraph || !text.startsWith('{') || !text.endsWith('}') || text.length < 3) return
  const second = text[1]
  if (second !== '.' && second !== '#' && !(second !== undefined && second >= 'a' && second <= 'z')) return
  if (context.state.attachedLines.has(line.number)) return
  const next = context.lines[line.number]
  if (next !== undefined && next.text.trim() !== '' && next.paragraph === false) return
  context.report('unattached-block-attribute', start, start + text.length, line.path)
}

function markdownDefinition(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (line.paragraph && !hasAncestor(line.path, context, 'definition_description') &&
    text.startsWith(': ') && prior(line, context)?.text.trim() !== '') {
    context.report('markdown-definition-paragraph', start, start + text.length, line.path)
  }
}

function emptyInclude(line: Line, context: LintContext): void {
  const at = line.text.indexOf('{{')
  if (at < 0 || !line.paragraph) return
  const end = line.text.indexOf('}}', at + 2)
  if (end < 0 || line.text.slice(at + 2, end).trim() !== '') return
  const text = line.text.slice(at, end + 2)
  context.report('empty-include-path', line.start + at, line.start + end + 2, line.path, { text })
}

function linkGap(line: Line, context: LintContext): void {
  const at = line.text.indexOf('] (')
  if (at >= 0 && line.paragraph) context.report('link-gap-before-destination', line.start + at, line.start + at + 3, line.path)
}

function djotPlus(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (line.paragraph && text.startsWith('+ ') && text.length > 2) {
    context.report('djot-plus-bullet', start, start + text.length, line.path)
  }
}

function definitionInContainer(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  const close = text.indexOf(']:')
  if (!line.paragraph || !text.startsWith('[') || close <= 1 || close + 2 >= text.length) return
  if (hasAncestor(line.path, context, 'footnote')) return
  if (line.text[0] !== ' ' && line.text[0] !== '\t' && line.path.split('/').length <= 3) return
  context.report('definition-in-container', start, start + text.length, line.path)
}

function foldedTerm(line: Line, context: LintContext): void {
  if (context.nodeTypes.get(line.path) !== 'definition_term') return
  if (firstLineOfPath(line.path, context) === line.number) return
  const { text, start } = trimmed(line)
  if (startsBlock(text)) context.report('definition-term-block-folded', start, start + text.length, line.path)
}

function githubAlert(line: Line, context: LintContext): void {
  const at = line.text.indexOf('[!')
  if (at < 0 || !line.text.slice(at).includes(']') || !line.text.trimStart().startsWith('>')) return
  context.report('github-alert-marker', line.start + at, line.end, line.path)
}

function djotHeadingContinuation(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (previous === undefined || !line.paragraph || line.text.trim() === '') return
  if (previous.text.startsWith('# ') && !line.text.startsWith(' ')) reportLine('djot-heading-continuation', line, context)
}

function quoteFenceSibling(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  if (previous === undefined || !trimmed(line).text.startsWith('::: >') || !previous.text.trimStart().startsWith('>')) return
  reportLine('quote-fence-ends-the-quote-above', line, context)
}

function regionAsText(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
  if (line.paragraph && (text.startsWith('#region ') || text.startsWith('#endregion'))) {
    context.report('region-marker-renders-as-text', start, start + text.length, line.path)
  }
}

function captionLooking(line: Line, context: LintContext): void {
  if (!line.paragraph) return
  const previous = prior(line, context)
  if (previous === undefined || !previous.text.trimStart().startsWith('|')) return
  const { text, start } = trimmed(line)
  if (text.startsWith('Table:') || text.startsWith('Figure:')) {
    context.report('caption-looking-paragraph', start, start + text.length, line.path)
  }
}

function descriptionColumn(line: Line, context: LintContext): void {
  const previous = prior(line, context)
  const { text, start } = trimmed(line)
  if (previous === undefined || !line.paragraph || (!text.startsWith(': ') && !text.startsWith(':: '))) return
  const host = trimmed(previous)
  if (!host.text.startsWith(': ') && !host.text.startsWith(':: ')) return
  if (start - line.start <= host.start - previous.start) return
  context.report('description-separator-below-content-column', start, start + text.length, line.path,
    { name: text.startsWith('::') ? 'term' : 'description', column: String(start - line.start + 1),
      'host.column': String(host.start - previous.start + 1) })
}

function rowWithoutPipe(line: Line, context: LintContext): void {
  const { text, start } = trimmed(line)
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
  spacedRule('description-separator-below-content-column', descriptionColumn),
  spacedRule('table-row-without-closing-pipe', rowWithoutPipe),
]
