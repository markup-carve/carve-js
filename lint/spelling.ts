import { type Line, type LintContext, type Rule } from './types.ts'

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
  spacedRule('table-row-without-closing-pipe', rowWithoutPipe),
]
