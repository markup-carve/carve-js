import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'

interface Rescue { output: string; record: ReportRecord }

function emptyDefinitionItem(line: string): boolean {
  if (line.length < 6 || (line[0] !== '*' && line[0] !== '-') || line[1] !== ' ') return false
  const body = line.slice(2)
  return body.startsWith('[') && !body.startsWith('[^') && body.endsWith(']:')
    && body.indexOf(']') === body.length - 2
}

function definitionItem(line: string): string | null {
  if ((line[0] !== '*' && line[0] !== '-') || line[1] !== ' ') return null
  const body = line.slice(2)
  const close = body.indexOf(']:')
  return body.startsWith('[') && !body.startsWith('[^') && close > 1 ? body : null
}

function nestedDefinitionItem(line: string): boolean {
  const marker = line.slice(0, 4)
  if (!['* * ', '* - ', '- * ', '- - '].includes(marker)) return false
  const body = line.slice(4)
  const close = body.indexOf(']:')
  return body.startsWith('[') && !body.startsWith('[^') && close > 1
}

function scopedDefinitionCandidate(lines: readonly string[], at: number): string | null {
  const line = lines[at]
  if (line === undefined) return null
  const body = definitionItem(line)
  if (body === null) return null
  const close = body.indexOf(']:')
  const tail = body.slice(close + 2)
  if (tail.trim() !== '' && !tail.startsWith(' ')) return null
  const moved = [...lines]
  moved[at] = `${line.slice(0, 2)}{% %}`
  const follower = moved[at + 1]
  if (follower !== undefined && follower.trim() !== '') moved[at + 1] = `\n${follower.trimStart()}`
  if (tail.trim() !== '') {
    const gap = at > 0 && lines[at - 1]?.trim() !== '' ? '\n' : ''
    moved.splice(at, 0, `${gap}${body.trimEnd()}\n`)
  }
  return moved.join('\n')
}

function preserves(expected: string, candidate: string): boolean {
  return compareHtml(expected, html02(candidate, false)).equal
}

function plainCandidate(lines: string[], expected: string): string | null {
  const output = lines.join('\n')
  const all = lines.map((line) => emptyDefinitionItem(line) ? `${line.slice(0, 2)}{% %}` : line).join('\n')
  if (all !== output && preserves(expected, all)) return all
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (line === undefined || !emptyDefinitionItem(line)) continue
    const candidateLines = [...lines]
    candidateLines[at] = `${line.slice(0, 2)}{% %}`
    const candidate = candidateLines.join('\n')
    if (preserves(expected, candidate)) return candidate
  }
  return null
}

function nestedCandidate(lines: string[], expected: string): string | null {
  for (let at = 0; at < lines.length - 1; at++) {
    const line = lines[at]
    const follower = lines[at + 1]
    if (line === undefined || follower === undefined || !nestedDefinitionItem(line)
      || !follower.startsWith(' ') || follower.trim() !== ':') continue
    const candidateLines = [...lines]
    candidateLines[at] = `${line.slice(0, 4)}{% %}`
    candidateLines[at + 1] = `\n${follower.trimStart()}`
    const candidate = candidateLines.join('\n')
    if (preserves(expected, candidate)) return candidate
  }
  return null
}

function siblingCandidate(lines: string[], expected: string): string | null {
  for (let at = 0; at < lines.length; at++) {
    const candidate = scopedDefinitionCandidate(lines, at)
    if (candidate !== null && preserves(expected, candidate)) return candidate
  }
  return null
}

/** C2-B-081, C2-B-083: 0.1 consumes a definition in an item. */
export function rescueEmptyDefinitionItem(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.split('\n').some((line) => definitionItem(line) !== null || nestedDefinitionItem(line))) return null
  const lines = output.split('\n')
  const expected = html01(input)
  const plain = plainCandidate(lines, expected)
  if (plain !== null) return { output: plain, record: recordOf('U-131', mismatch.line,
    'the empty definition was consumed in 0.1, leaving an empty list item') }
  const nested = nestedCandidate(lines, expected)
  if (nested !== null) return { output: nested, record: recordOf('U-131', mismatch.line,
    'the nested definition was consumed in 0.1 and the following line stood outside the list') }
  const sibling = siblingCandidate(lines, expected)
  return sibling === null ? null : { output: sibling, record: recordOf('U-131', mismatch.line,
    'the consumed definition was placed before its list and its sibling was released') }
}
