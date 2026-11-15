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

function nestedDefinitionItem(line: string): boolean {
  const marker = line.slice(0, 4)
  if (!['* * ', '* - ', '- * ', '- - '].includes(marker)) return false
  const body = line.slice(4)
  const close = body.indexOf(']:')
  return body.startsWith('[') && !body.startsWith('[^') && close > 1
}

/** C2-B-081, C2-B-083: 0.1 consumes an empty definition in an item. */
export function rescueEmptyDefinitionItem(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.split('\n').some((line) => emptyDefinitionItem(line) || nestedDefinitionItem(line))) return null
  const lines = output.split('\n')
  const expected = html01(input)
  const all = lines.map((line) => emptyDefinitionItem(line) ? `${line.slice(0, 2)}{% %}` : line).join('\n')
  if (all !== output && compareHtml(expected, html02(all, false)).equal) {
    return { output: all, record: recordOf('U-131', mismatch.line,
      'the empty 0.1 definitions were consumed, leaving empty list items') }
  }
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (line === undefined || !emptyDefinitionItem(line)) continue
    const candidateLines = [...lines]
    candidateLines[at] = `${line.slice(0, 2)}{% %}`
    const candidate = candidateLines.join('\n')
    if (!compareHtml(expected, html02(candidate, false)).equal) continue
    return { output: candidate, record: recordOf('U-131', mismatch.line,
      'the empty 0.1 definition was consumed, leaving an empty list item') }
  }
  for (let at = 0; at < lines.length - 1; at++) {
    const line = lines[at]
    const follower = lines[at + 1]
    if (line === undefined || follower === undefined || !nestedDefinitionItem(line)
      || !follower.startsWith(' ') || follower.trim() !== ':') continue
    const candidateLines = [...lines]
    candidateLines[at] = `${line.slice(0, 4)}{% %}`
    candidateLines[at + 1] = `\n${follower.trimStart()}`
    const candidate = candidateLines.join('\n')
    if (!compareHtml(expected, html02(candidate, false)).equal) continue
    return { output: candidate, record: recordOf('U-131', mismatch.line,
      'the nested definition was consumed in 0.1 and the following colon stood outside the list') }
  }
  return null
}
