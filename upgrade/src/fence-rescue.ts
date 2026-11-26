import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

const FENCE_RESCUE_REACH = 12

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

function lengthenedCloser(output: string, lines: ReturnType<typeof readLines>, open: number, middle: number): string[] {
  const found: string[] = []
  for (let close = middle + 1; close <= Math.min(lines.count, middle + 6); close++) {
    if (lineText(lines, close) !== '```') continue
    let candidate = output
    for (const line of [close, open]) {
      const at = lineStart(lines, line)
      candidate = candidate.slice(0, at) + '`' + candidate.slice(at)
    }
    found.push(candidate)
  }
  return found
}

function longerFence(output: string, mismatchLine: number): string[] {
  const lines = readLines(output)
  const found: string[] = []
  for (let open = 1; open < Math.min(lines.count - 2, mismatchLine + FENCE_RESCUE_REACH); open++) {
    if (lineText(lines, open).trim() !== '```') continue
    for (let middle = open + 1; middle < lines.count - 1; middle++) {
      const middleText = lineText(lines, middle)
      if (middleText.trim() === '```' && middleText !== '```') {
        found.push(...lengthenedCloser(output, lines, open, middle))
      }
    }
  }
  return found
}

function secondFence(output: string, mismatchLine: number): string[] {
  const lines = readLines(output)
  const found: string[] = []
  for (let line = 2; line < Math.min(lines.count - 1, mismatchLine + FENCE_RESCUE_REACH); line++) {
    if (lineText(lines, line).trim() !== '```' || lineText(lines, line + 1).trim() !== '') continue
    const follower = lineText(lines, line + 2)
    if (follower.trim() === '') continue
    const indent = follower.length - follower.trimStart().length
    const at = lineStart(lines, line + 2)
    found.push(output.slice(0, at) + ' '.repeat(indent) + '```\n\n' + output.slice(at))
  }
  return found
}

function descriptionFenceBoundary(output: string, mismatchLine: number): string[] {
  const lines = output.split('\n')
  const found: string[] = []
  for (let open = 1; open < Math.min(lines.length - 3, mismatchLine + FENCE_RESCUE_REACH); open++) {
    const opener = lines[open] ?? ''
    if (opener.trim() !== '```' || !(lines[open - 1] ?? '').trimStart().startsWith(': ')) continue
    const indent = opener.length - opener.trimStart().length
    if (indent === 0) continue
    for (let follower = open + 2; follower < Math.min(lines.length - 1, open + 12); follower++) {
      const value = lines[follower] ?? ''
      const column = value.length - value.trimStart().length
      if (value.trim() === '' || column === 0 || column >= indent) continue
      if (!lines.slice(follower + 1, follower + 12).some((line) => line.trim() === '```')) continue
      const moved = [...lines]
      moved[follower] = value.trimStart()
      moved.splice(follower, 0, ' '.repeat(indent) + '```')
      found.push(moved.join('\n'))
    }
  }
  return found
}

function closerAfterBlank(lines: string[], blank: number, marker: number): string | null {
  const follower = lines[blank + 1] ?? ''
  if (follower.trim() === '') return null
  const indent = follower.length - follower.trimStart().length
  if (indent >= marker) return null
  const candidate = [...lines]
  candidate.splice(blank + 1, 0, ' '.repeat(marker) + '```')
  return candidate.join('\n')
}

function trailingBlankFence(output: string, mismatchLine: number): string[] {
  const lines = output.split('\n')
  const found: string[] = []
  for (let open = 0; open < Math.min(lines.length - 3, mismatchLine + FENCE_RESCUE_REACH); open++) {
    const value = lines[open] ?? ''
    const marker = value.indexOf('```')
    if (marker < 0 || value.slice(marker).trim() !== '```') continue
    for (let blank = open + 1; blank < Math.min(lines.length - 1, open + 12); blank++) {
      if ((lines[blank] ?? '').trim() !== '') continue
      const candidate = closerAfterBlank(lines, blank, marker)
      if (candidate !== null) found.push(candidate)
    }
  }
  return found
}

function firstPreserving(expected: string, candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (compareHtml(expected, html02(candidate, false)).equal) return candidate
    } catch {
      /* A candidate can fail to parse under the new grammar. */
    }
  }
  return null
}

/** C2-B-057, C2-B-109 and C2-B-111: close an item fence where 0.1 kept its body. */
export function rescueFence(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('```')) return null
  const expected = html01(input)
  const trailing = firstPreserving(expected, trailingBlankFence(output, mismatch.line))
  if (trailing !== null) return { output: trailing, record: recordOf('U-135', mismatch.line,
    'the fence was closed after its retained trailing blank line under C2-B-113') }
  const description = firstPreserving(expected, descriptionFenceBoundary(output, mismatch.line))
  if (description !== null) return { output: description, record: recordOf('U-179', mismatch.line,
    'the description fence was closed before the following block at its 0.1 boundary') }
  const item = firstPreserving(expected, [...variants(output, Math.max(1, mismatch.line)),
    ...longerFence(output, mismatch.line), ...secondFence(output, mismatch.line)])
  if (item !== null) return { output: item, record: recordOf('U-127', mismatch.line,
    'the fence was closed at the item boundary while preserving 0.1 HTML') }
  return null
}
