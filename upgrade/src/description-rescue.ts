import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineEnd, lineStart, lineText, readLines } from './source.ts'

interface Rescue {
  output: string
  record: ReportRecord
}

function startsBlock(value: string): boolean {
  return ['# ', '```', ':::', '***', '- ', '* '].some((prefix) => value.startsWith(prefix))
}

function blockVariants(
  output: string,
  value: string,
  trimmed: string,
  above: string,
  start: number,
  end: number
): string[] {
  if (value === trimmed || !startsBlock(trimmed) || (!above.startsWith(': ') && above !== '')) return []
  const first = output.slice(0, start) + trimmed + output.slice(end)
  return above === '' ? [first] : [first, output.slice(0, start) + '\n' + trimmed + output.slice(end)]
}

function variants(output: string, mismatchLine: number): string[] {
  const lines = readLines(output)
  const found = new Set<string>()
  for (let line = Math.max(1, mismatchLine - 3); line <= Math.min(lines.count, mismatchLine + 3); line++) {
    const value = lineText(lines, line)
    const trimmed = value.trimStart()
    const start = lineStart(lines, line)
    const end = lineEnd(lines, line)
    if (trimmed.startsWith(':: ') || trimmed.startsWith(': ')) {
      for (let indent = 0; indent <= 8; indent++) {
        const candidate = output.slice(0, start) + ' '.repeat(indent) + trimmed + output.slice(end)
        if (candidate !== output) found.add(candidate)
      }
    }
    const above = lineText(lines, line - 1).trimStart()
    for (const candidate of blockVariants(output, value, trimmed, above, start, end)) found.add(candidate)
  }
  return [...found]
}

function alignedFollowerVariants(
  lines: string[], line: number, markerColumn: number, term: string, follower: string, direct: string[]
): string[] {
  if ((lines[line - 1] ?? '').indexOf(':') === markerColumn) return []
  const found: string[] = []
  for (let indent = 0; indent <= 4; indent++) {
    const aligned = [...direct]
    aligned[line - 1] = ' '.repeat(indent) + term
    aligned[line] = ' '.repeat(indent) + ': ' + follower
    found.push(aligned.join('\n'))
  }
  return found
}

function plusVariants(input: string): string[] {
  const found: string[] = []
  const lines = input.split('\n')
  for (let line = 1; line < Math.min(lines.length - 1, 10); line++) {
    const body = (lines[line] ?? '').trimStart()
    const term = (lines[line - 1] ?? '').trimStart()
    if (!term.startsWith(':: ') || !body.startsWith(': ') || body.slice(1).trim() !== '+') continue
    const follower = (lines[line + 1] ?? '').trimStart()
    for (let indent = 0; indent <= 4; indent++) {
      const changed = [...lines]
      changed[line - 1] = ' '.repeat(indent) + term
      changed[line] = ' '.repeat(indent) + ': {% %}'
      changed[line + 1] = '\n' + ' '.repeat(indent) + follower
      found.push(changed.join('\n'))
    }
    const direct = [...lines]
    const markerColumn = (lines[line] ?? '').indexOf(':')
    direct[line] = (lines[line] ?? '').slice(0, markerColumn) + ': ' + follower
    direct.splice(line + 1, 1)
    found.push(direct.join('\n'))
    found.push(...alignedFollowerVariants(lines, line, markerColumn, term, follower, direct))
    const sibling = direct[line + 1] ?? ''
    if (sibling.trimStart().startsWith(': ') && sibling !== sibling.trimStart()) {
      const atColumn = [...direct]
      atColumn[line + 1] = sibling.trimStart()
      found.push(atColumn.join('\n'))
    }
  }
  return found
}

function quotedPlusVariants(input: string): string[] {
  const lines = input.split('\n')
  const found: string[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    if (!(lines[at] ?? '').trimStart().startsWith('> :: ')) continue
    if ((lines[at + 1] ?? '').trimStart() !== '> : +') continue
    const prefix = (lines[at] ?? '').slice(0, (lines[at] ?? '').indexOf('>'))
    const moved = [...lines]
    moved[at + 1] = prefix + '> : {% %}'
    moved[at + 2] = `\n${(lines[at + 2] ?? '').trimStart()}`
    found.push(moved.join('\n'))
    const follower = (lines[at + 2] ?? '').trimStart()
    if (follower.startsWith('> ')) {
      const attached = [...lines]
      attached[at + 1] = prefix + '> : ' + follower.slice(2)
      attached.splice(at + 2, 1)
      found.push(attached.join('\n'))
      const sibling = (attached[at + 2] ?? '').trimStart()
      if (sibling.startsWith('>  : ')) {
        const dedented = [...attached]
        dedented[at + 2] = prefix + '> : ' + sibling.slice(5)
        found.push(dedented.join('\n'))
      }
    }
  }
  return found
}

function descriptionFenceCandidate(lines: string[], at: number, fence: string, marker: string): string {
  const close = lines.findIndex((line, index) => index > at + 2 && line.trim() === marker)
  const moved = [...lines]
  moved[at + 1] = ': ```' + fence.slice(3)
  moved.splice(at + 2, 1)
  if (close >= 0) moved[close - 1] = '```'
  const end = close < 0 ? moved.length : close
  for (let next = at + 2; next < end; next++) {
    if (moved[next]?.trim() !== '') moved[next] = `  ${moved[next]}`
  }
  return moved.join('\n')
}

function descriptionFenceVariants(input: string): string[] {
  const lines = input.split('\n')
  const found: string[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    if (!(lines[at] ?? '').trimStart().startsWith(':: ')) continue
    if ((lines[at + 1] ?? '').trimStart() !== ': +') continue
    const fence = (lines[at + 2] ?? '').trimStart()
    const marker = fence.slice(0, 3)
    if (marker !== '```' && marker !== '~~~' || fence[3] === marker[0]) continue
    found.push(descriptionFenceCandidate(lines, at, fence, marker))
  }
  return found
}

function descriptionListPlusVariants(input: string): string[] {
  const lines = input.split('\n')
  const found: string[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    if (!(lines[at] ?? '').trimStart().startsWith(':: ')) continue
    if ((lines[at + 1] ?? '').trimStart() !== ': - +') continue
    const heading = (lines[at + 2] ?? '').trimStart()
    if (!heading.startsWith('# ')) continue
    const column = (lines[at + 1] ?? '').indexOf(':')
    const moved = [...lines]
    moved[at + 1] = ' '.repeat(column) + ': - {% %}'
    moved[at + 2] = '\n' + ' '.repeat(column + 2) + heading
    found.push(moved.join('\n'))
  }
  return found
}

function isListMarker(value: string): boolean {
  return value.startsWith('- ') || value.startsWith('* ') || value.startsWith('. ')
}

function blankBodyBoundary(lines: string[], at: number, found: string[]): void {
  if (at < 2 || (lines[at - 1] ?? '').trim() !== '') return
  if (!(lines[at - 2] ?? '').trimStart().startsWith(': ')) return
  const current = lines[at] ?? ''
  if (current === current.trimStart() || current.trim() === '') return
  const changed = [...lines]
  changed[at] = current.trimStart()
  found.push(changed.join('\n'))
}

function dedentRefusedFollower(lines: string[], at: number, found: string[]): void {
  const previous = (lines[at - 1] ?? '').trimStart()
  if (!previous.startsWith(': ')) return
  const body = previous.slice(2).trimStart()
  if (body !== '%%' && !body.startsWith('%% ') && !body.startsWith(':::')) return
  const written = lines[at] ?? ''
  if (!written.startsWith(' ') || written.trim() === '') return
  const changed = [...lines]
  changed[at] = written.trimStart()
  found.push(changed.join('\n'))
}

function boundaryVariants(output: string): string[] {
  const lines = output.split('\n')
  const found: string[] = []
  for (let at = 1; at < lines.length - 1; at++) {
    const previous = (lines[at - 1] ?? '').trimStart()
    const current = (lines[at] ?? '').trimStart()
    blankBodyBoundary(lines, at, found)
    dedentRefusedFollower(lines, at, found)
    if (previous.startsWith(': ') && current.startsWith('>')) {
      const changed = [...lines]
      changed[at] = '\n' + current
      found.push(changed.join('\n'))
    }
    if (previous.startsWith(': ') && current.startsWith('{') && current.endsWith('}')) {
      const changed = [...lines]
      changed[at] = ''
      found.push(changed.join('\n'))
    }
    if (!isListMarker(previous)) continue
    if (!current.startsWith(':: ') || !(lines[at + 1] ?? '').trimStart().startsWith(': ')) continue
    const changed = [...lines]
    changed[at] = '\n' + current
    changed[at + 1] = (lines[at + 1] ?? '').trimStart()
    found.push(changed.join('\n'))
  }
  return found
}

function definitionVariants(input: string): string[] {
  const lines = input.split('\n')
  const found: string[] = []
  for (let at = 1; at < lines.length; at++) {
    const value = (lines[at] ?? '').trimStart()
    if (!value.startsWith(': ')) continue
    const body = value.slice(2).trimStart()
    const close = body.indexOf(']:')
    if (!body.startsWith('[') || close < 2) continue
    if (!(lines[at - 1] ?? '').trimStart().startsWith(':: ')) continue
    const changed = [...lines]
    changed[at] = (lines[at] ?? '').slice(0, (lines[at] ?? '').length - value.length) + ': {% %}'
    found.push(body + '\n\n' + changed.join('\n'))
  }
  return found
}

function noteDescriptionVariants(input: string): string[] {
  const lines = input.split('\n')
  const found: string[] = []
  for (let at = 0; at < lines.length - 1; at++) {
    const head = (lines[at] ?? '').trimStart()
    const body = lines[at + 1] ?? ''
    if (!head.startsWith('[^') || !head.includes(']: :: ') || !body.startsWith('  : ')) continue
    const changed = [...lines]
    changed[at + 1] = '      ' + body.trimStart()
    for (let next = at + 2; next < lines.length; next++) {
      const value = lines[next] ?? ''
      if (value.trim() === '' || !value.startsWith(' ')) break
      const indent = value.length - value.trimStart().length
      changed[next] = indent < 2 ? value.trimStart() : '    ' + value
    }
    found.push(changed.join('\n'))
  }
  return found
}

function descriptionSiblingVariants(input: string): string[] {
  const lines = input.split('\n')
  const found: string[] = []
  for (let at = 3; at < lines.length; at++) {
    const value = lines[at] ?? ''
    if ((lines[at - 1] ?? '').trim() !== '' || !value.startsWith('   ')) continue
    if (!(lines[at - 3] ?? '').trimStart().startsWith(':: ')) continue
    if (!(lines[at - 2] ?? '').trimStart().startsWith(': - ')) continue
    if (!value.trimStart().startsWith('- ') && !value.trimStart().startsWith('> ')) continue
    const changed = [...lines]
    changed[at] = ' ' + value.trimStart()
    found.push(changed.join('\n'))
  }
  return found
}

function descriptionTableVariants(input: string): string[] {
  const lines = input.split('\n')
  const found: string[] = []
  for (let at = 2; at < lines.length; at++) {
    if (!(lines[at - 2] ?? '').trimStart().startsWith(':: ')) continue
    if (!(lines[at - 1] ?? '').trimStart().startsWith(': ')) continue
    const value = lines[at] ?? ''
    if (!value.startsWith(' ') || !value.trimStart().startsWith('|')) continue
    const changed = [...lines]
    changed[at] = value.trimStart()
    found.push(changed.join('\n'))
  }
  return found
}

function compoundDescriptionVariants(input: string): string[] {
  const lines = input.split('\n')
  const marks = lines.map((line) => {
    const trimmed = line.trimStart()
    return line.startsWith(' ') && (trimmed.startsWith(':: ') || trimmed.startsWith(': ')) ? trimmed : line
  })
  const found = marks.join('\n') === input ? [] : [marks.join('\n')]
  for (let at = 3; at < lines.length; at++) {
    const value = lines[at] ?? ''
    if (!value.startsWith('    ') || !value.trimStart().startsWith('>')) continue
    if ((lines[at - 1] ?? '').trim() !== '') continue
    if (!(lines[at - 2] ?? '').trimStart().startsWith(': ')) continue
    if (!(lines[at - 3] ?? '').trimStart().startsWith(':: ')) continue
    for (const indent of [3, 2, 1]) {
      const changed = [...lines]
      changed[at] = ' '.repeat(indent) + value.trimStart()
      found.push(changed.join('\n'))
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

/** C2-B-069, C2-B-076 and C2-B-078: put the mark and body at an owning column. */
export function rescueDescription(input: string, output: string, mismatch: ReportRecord): Rescue | null {
  if (!input.includes('::')) return null
  const expected = html01(input)
  const mark = firstPreserving(expected, variants(output, Math.max(1, mismatch.line)))
  if (mark !== null) {
    const id = input.startsWith(':: ') && mark.startsWith(' :: ') ? 'U-180' : 'U-128'
    return {
      output: mark,
      record: recordOf(
        id,
        mismatch.line,
        'the description mark was moved to its 0.2 ownership column while preserving 0.1 HTML'
      )
    }
  }
  const definition = firstPreserving(expected, definitionVariants(input))
  if (definition !== null) return { output: definition, record: recordOf('U-210', mismatch.line,
    'the definition was moved to document scope and the description kept its empty 0.1 body') }
  const note = firstPreserving(expected, noteDescriptionVariants(input))
  if (note !== null) return { output: note, record: recordOf('U-223', mismatch.line,
    'the note-hosted description body was moved to its content column') }
  const sibling = firstPreserving(expected, descriptionSiblingVariants(input))
  if (sibling !== null) return { output: sibling, record: recordOf('U-228', mismatch.line,
    'the sibling block was moved to the description content column') }
  const table = firstPreserving(expected, descriptionTableVariants(input))
  if (table !== null) return { output: table, record: recordOf('U-232', mismatch.line,
    'the table row was moved to the description boundary column') }
  const compound = firstPreserving(expected, compoundDescriptionVariants(input))
  if (compound !== null) return { output: compound, record: recordOf('U-236', mismatch.line,
    'the description sibling was moved to its 0.2 owning column') }
  const plus = firstPreserving(expected,
    [...plusVariants(input), ...quotedPlusVariants(input), ...descriptionFenceVariants(input),
      ...descriptionListPlusVariants(input)])
  if (plus !== null)
    return {
      output: plus,
      record: recordOf(
        'U-123',
        mismatch.line,
        'the description continuation was written at its 0.2 owning column while preserving the full HTML'
      )
    }
  const boundary = firstPreserving(expected, [...boundaryVariants(input), ...boundaryVariants(output)])
  if (boundary !== null)
    return {
      output: boundary,
      record: recordOf(
        'U-199',
        mismatch.line,
        'the description boundary was written at its 0.2 owning column while preserving 0.1 HTML'
      )
    }
  return null
}
