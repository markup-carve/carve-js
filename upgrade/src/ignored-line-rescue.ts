import { compareHtmlExact } from './compare.ts'
import { type Context } from './context.ts'
import { offsetBefore, type Edit } from './edits.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineOf, lineStart, lineText, readLines } from './source.ts'

function originalLine(input: string, outputStart: number, value: string, edits: Edit[]): number {
  const lines = readLines(input)
  const mapped = lineOf(lines, offsetBefore(edits, outputStart))
  let closest = mapped
  let distance = Infinity
  for (let line = 1; line <= lines.count; line++) {
    if (lineText(lines, line).trimStart() !== value.trimStart()) continue
    const nextDistance = Math.abs(line - mapped)
    if (nextDistance < distance) { closest = line; distance = nextDistance }
  }
  return closest
}

function unreferencedDefinition(referenced: Set<string>, value: string): boolean {
  const label = /^[ \t]*\[\^([^\]\n]+)\]:/u.exec(value)?.[1]
  return label !== undefined && !referenced.has(label)
}

function nearbyDefinitions(ctx: Context, output: ReturnType<typeof readLines>, mismatchLine: number): number[] {
  const referenced = new Set(ctx.visits.filter(({ node }) => node.type === 'footnote_ref')
    .map(({ node }) => String(node.label)))
  const found: number[] = []
  for (let line = Math.min(mismatchLine, output.count); line >= 1 && found.length < 4; line--) {
    if (unreferencedDefinition(referenced, lineText(output, line))) found.push(line)
  }
  for (let line = mismatchLine + 1; line <= Math.min(output.count, mismatchLine + 4) && found.length < 4; line++) {
    if (unreferencedDefinition(referenced, lineText(output, line))) found.push(line)
  }
  return found
}

/** A line swallowed by the old parser can be omitted when both complete renders prove that it had no effect. */
export function rescueIgnoredLine(input: string, output: string, mismatch: ReportRecord, edits: Edit[], ctx: Context):
  { output: string; record: ReportRecord } | null {
  if (!input.includes('[^') || mismatch.line < 1) return null
  const lines = readLines(output)
  const old = html01(input)
  const first = Math.max(1, mismatch.line - 2)
  const last = Math.min(lines.count, mismatch.line + 2)
  const candidates: number[] = []
  for (let line = first; line <= last; line++) {
    if (/^[ \t]*>[ \t]+\S/u.test(lineText(lines, line))) candidates.push(line)
  }
  candidates.push(...nearbyDefinitions(ctx, lines, mismatch.line))
  for (const line of new Set(candidates)) {
    const start = lineStart(lines, line)
    const end = line < lines.count ? lineStart(lines, line + 1) : lineEnd(lines, line)
    const sourceLine = originalLine(input, start, lineText(lines, line), edits)
    if (lineText(lines, line).trimStart().startsWith('[^')
      && !lineText(readLines(input), sourceLine).startsWith('[^')) continue
    const candidate = output.slice(0, start) + output.slice(end)
    try {
      if (!compareHtmlExact(old, html01(candidate)).equal || !compareHtmlExact(old, html02(candidate, false)).equal) continue
      return { output: candidate, record: { ...recordOf('U-209', sourceLine,
        'a line the old parser did not render was omitted after complete HTML verification'), class: 'rewrite' } }
    } catch { /* A candidate can be invalid under either grammar. */ }
  }
  return null
}
