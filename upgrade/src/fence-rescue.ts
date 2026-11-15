import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

function listFence(text: string): string | null {
  const trimmed = text.trimStart()
  const first = trimmed[0]
  if (first !== '-' && first !== '*' && first !== '.') return null
  const run = text.indexOf('```')
  if (run < 0) return null
  for (let at = 0; at < run; at++) {
    const char = text[at]
    if (char !== '-' && char !== '*' && char !== '.' && char !== ' ' && char !== '\t') return null
  }
  return ' '.repeat(run) + '```'
}

function variants(output: string, mismatchLine: number): string[] {
  const lines = readLines(output)
  const found = new Set<string>()
  for (let open = 1; open <= lines.count; open++) {
    const closer = listFence(lineText(lines, open))
    if (closer === null || Math.abs(open - mismatchLine) > 6) continue
    for (let line = open + 1; line <= Math.min(lines.count, open + 8); line++) {
      const at = lineStart(lines, line)
      const text = lineText(lines, line)
      found.add(output.slice(0, at) + closer + '\n' + output.slice(at))
      found.add(output.slice(0, at) + closer + '\n\n' + output.slice(at))
      if (text.trim() === '+') found.add(output.slice(0, at) + closer + output.slice(lineEnd(lines, line)))
    }
    found.add(output + (output.endsWith('\n') ? '' : '\n') + closer)
  }
  found.delete(output)
  return [...found]
}

function longerFence(output: string): string[] {
  const lines = readLines(output)
  const found: string[] = []
  for (let open = 1; open < lines.count - 2; open++) {
    if (lineText(lines, open).trim() !== '```') continue
    for (let middle = open + 1; middle < lines.count - 1; middle++) {
      if (lineText(lines, middle).trim() !== '```') continue
      const middleText = lineText(lines, middle)
      if (middleText === '```') continue
      for (let close = middle + 1; close <= Math.min(lines.count, middle + 6); close++) {
        if (lineText(lines, close) !== '```') continue
        let candidate = output
        for (const line of [close, open]) {
          const at = lineStart(lines, line)
          candidate = candidate.slice(0, at) + '`' + candidate.slice(at)
        }
        found.push(candidate)
      }
    }
  }
  return found
}

function secondFence(output: string): string[] {
  const lines = readLines(output)
  const found: string[] = []
  for (let line = 2; line < lines.count - 1; line++) {
    if (lineText(lines, line).trim() !== '```' || lineText(lines, line + 1).trim() !== '') continue
    const follower = lineText(lines, line + 2)
    if (follower.trim() === '') continue
    const indent = follower.length - follower.trimStart().length
    const at = lineStart(lines, line + 2)
    found.push(output.slice(0, at) + ' '.repeat(indent) + '```\n\n' + output.slice(at))
  }
  return found
}

/** C2-B-057, C2-B-109 and C2-B-111: close an item fence where 0.1 kept its body. */
export function rescueFence(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('```')) return null
  const expected = html01(input)
  for (const candidate of [...variants(output, Math.max(1, mismatch.line)), ...longerFence(output), ...secondFence(output)]) {
    try {
      if (!compareHtml(expected, html02(candidate, false)).equal) continue
      return { output: candidate, record: recordOf('U-127', mismatch.line,
        'the fence was closed at the item boundary while preserving 0.1 HTML') }
    } catch { /* A candidate can fail to parse under the new grammar. */ }
  }
  return null
}
