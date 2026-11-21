import { compareHtml } from './compare.ts'
import { html01, html02 } from './engines.ts'
import { recordOf, type ReportRecord } from './report.ts'
import { lineStart, lineText, readLines } from './source.ts'

interface Candidate {
  entry: string
  output: string
  message: string
}

function candidate(entry: string, output: string, message: string): Candidate {
  return { entry, output, message }
}

function trailingFence(output: string): Candidate[] {
  if (!output.endsWith('\n\n') || !output.includes('```')) return []
  const found: Candidate[] = []
  for (let indent = 0; indent <= 8; indent++) {
    for (let length = 3; length <= 8; length++) {
      found.push(
        candidate(
          'U-135',
          output + ' '.repeat(indent) + '`'.repeat(length) + '\n',
          'an explicit closer retains the trailing blank code line'
        )
      )
    }
  }
  return found
}

function indentedFenceRunAsContent(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length; at++) {
    if ((lines[at] ?? '').trim() !== '```' || (lines[at] ?? '') !== '```') continue
    if (!lines.slice(at + 1).some((line) => line.startsWith('  ```'))) continue
    const changed = [...lines]
    changed[at] = '````'
    found.push(candidate('U-242', changed.join('\n'), 'the opening fence was lengthened to keep the indented run as content'))
  }
  return found
}

function blockAttributeAcrossFootnote(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 3; at++) {
    const attribute = lines[at] ?? ''
    const definition = lines[at + 1] ?? ''
    if (!attribute.startsWith('{') || !attribute.endsWith('}') || !definition.startsWith('[^')) continue
    if (!definition.includes(']:') || lines[at + 2] !== '' || (lines[at + 3] ?? '') === '') continue
    const changed = [...lines]
    changed.splice(at, 1)
    changed.splice(at + 2, 0, attribute)
    found.push(candidate('U-244', changed.join('\n'), 'the floating block attribute was moved after the footnote definition'))
  }
  return found
}

function quotedItemFenceBlank(output: string): Candidate[] {
  if (!output.includes('> 1. ```')) return []
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 1; at++) {
    if (lines[at] !== '>' || !(lines[at + 1] ?? '').startsWith('> ')) continue
    const changed = [...lines]
    changed.splice(at + 1, 0, '>    ```')
    found.push(candidate('U-245', changed.join('\n'), 'the quoted list fence was explicitly closed after its blank code line'))
  }
  return found
}

function unresolvedFootnoteHeadingId(output: string): Candidate[] {
  const open = output.indexOf(']{#')
  if (open < 0 || !output.slice(0, open).includes('[^')) return []
  const close = output.indexOf('}', open + 3)
  if (close < 0) return []
  const id = output.slice(open + 3, close)
  if (id === '' || id.includes('\n')) return []
  const heading = `\n## {#${id}}`
  const at = output.indexOf(heading, close + 1)
  if (at < 0) return []
  const first = output.slice(0, open + 1) + '{\\#' + id + '}' + output.slice(close + 1)
  const second = first.indexOf(heading)
  const rewritten = first.slice(0, second) + `\n{#${id}}\n## \\{#${id}}` + first.slice(second + heading.length)
  return [candidate('U-246', rewritten, 'the unresolved attribute was escaped and the heading id moved above its text')]
}

function tableAfterOrderedItem(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 1; at < lines.length; at++) {
    const value = lines[at] ?? ''
    const previous = lines[at - 1] ?? ''
    if (!value.startsWith('   |') || !previous.includes('. ')) continue
    const changed = [...lines]
    changed[at] = value.trimStart()
    found.push(candidate('U-247', changed.join('\n'), 'the table row was moved outside the preceding ordered item'))
  }
  return found
}

function nestedFootnoteFence(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    const marker = lines[at] ?? ''
    const code = lines[at + 1] ?? ''
    if (!marker.startsWith('- [^') || !marker.endsWith(']: ```')) continue
    if (!code.startsWith('    ') || lines[at + 2] !== '') continue
    const definition = marker.slice(2)
    const changed = [...lines]
    changed.splice(at, 3, '- {% %}', '', definition, '      ' + code.trimStart(), '', '      ```')
    found.push(candidate('U-250', changed.join('\n'), 'the note fence was moved outside the empty list item and closed'))
  }
  return found
}

function closeDivBeforeFootnote(output: string): Candidate[] {
  if (!output.includes(':::') || !output.includes('[^')) return []
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 1; at < lines.length; at++) {
    if (!(lines[at] ?? '').startsWith('[^') || !(lines[at] ?? '').includes(']:')) continue
    const changed = [...lines]
    changed.splice(at, 0, ':::', '')
    found.push(candidate('U-253', changed.join('\n'), 'the open div was closed before the footnote definition'))
  }
  return found
}

function inlineComment(output: string): Candidate[] {
  const found: Candidate[] = []
  let at = output.indexOf('{%')
  while (at >= 0) {
    found.push(
      candidate('U-136', output.slice(0, at) + '\\' + output.slice(at), 'the literal brace comment opener was escaped')
    )
    at = output.indexOf('{%', at + 2)
  }
  return found
}

function emptyItemAttribute(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 1; line <= lines.count; line++) {
    let text = lineText(lines, line).trimStart()
    while (text.startsWith('> ')) text = text.slice(2).trimStart()
    const item = text.startsWith('- {') || text.startsWith('* {') || text.startsWith('. {')
    const description = text.startsWith(': {')
    if (!item && !description) continue
    const open = output.indexOf('{', lineStart(lines, line))
    const close = output.indexOf('}', open + 1)
    if (close < 0 || close >= lineStart(lines, line + 1)) continue
    const rewritten = output.slice(0, open) + '{% %}' + output.slice(close + 1)
    const id = item ? 'U-137' : 'U-142'
    found.push(candidate(id, rewritten, 'the empty item attribute was written as an empty comment'))
    const end = rewritten.indexOf('\n', lineStart(lines, line))
    if (end >= 0 && lineText(lines, line + 1).trim() !== '') {
      found.push(
        candidate(
          id,
          rewritten.slice(0, end + 1) + '\n' + rewritten.slice(end + 1),
          'the empty item attribute and its following block boundary were rewritten'
        )
      )
    }
  }
  return found
}

function emptyDescriptionSentinels(output: string): Candidate[] {
  let changed = false
  const rewritten = output.split('\n').map((line) => {
    if (line.trimStart() !== ': {empty}') return line
    changed = true
    return line.replace('{empty}', '{% %}')
  }).join('\n')
  return changed ? [candidate('U-142', rewritten, 'all empty description sentinels became empty comments')] : []
}

function quotedAttribute(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 1; line <= lines.count; line++) {
    const value = lineText(lines, line)
    const open = value.indexOf('{')
    const close = value.indexOf('}', open + 1)
    if (open < 0 || close < 0 || value.slice(close + 1).trim() !== '') continue
    if (!value.slice(0, open).trimEnd().endsWith('>')) continue
    const cut = open > 0 && value[open - 1] === ' ' ? open - 1 : open
    const start = lineStart(lines, line) + cut
    found.push(
      candidate(
        'U-141',
        output.slice(0, start) + output.slice(lineStart(lines, line) + close + 1),
        'the attribute line that 0.1 consumed was removed from the quote'
      )
    )
  }
  return found
}

function multilineQuotedAttribute(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 1; at++) {
    const head = lines[at] ?? ''
    const tail = lines[at + 1] ?? ''
    if (!head.startsWith('- > {') || !tail.startsWith('  > ') || !tail.trimEnd().endsWith('}')) continue
    const changed = [...lines]
    changed.splice(at, 2, '- >')
    found.push(candidate('U-141', changed.join('\n'), 'the multiline attribute consumed by the quote was removed'))
  }
  for (let at = 0; at < lines.length - 2; at++) {
    const head = lines[at] ?? ''
    const tail = lines[at + 1] ?? ''
    if (!head.startsWith('> > - {') || !tail.startsWith('> >    ') || !tail.trimEnd().endsWith('}')) continue
    const changed = [...lines]
    changed.splice(at, 2, '> > - {% %}', '')
    found.push(candidate('U-141', changed.join('\n'),
      'the multiline attribute consumed inside the quoted item became an empty comment'))
  }
  return found
}

function conflictingListStart(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 1; at++) {
    const value = lines[at] ?? ''
    const next = lines[at + 1] ?? ''
    if (!value.startsWith('{start=') || !value.endsWith('}') || !next.includes('. ')) continue
    const changed = [...lines]
    changed.splice(at, 1)
    found.push(candidate('U-230', changed.join('\n'), 'the conflicting list start attribute was removed'))
  }
  return found
}

function consumedListAttribute(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 2; line < lines.count; line++) {
    const value = lineText(lines, line).trim()
    if (!value.startsWith('{') || !value.endsWith('}')) continue
    const next = lineText(lines, line + 1).trimStart()
    if (!next.startsWith('# ') && !next.startsWith(':::') && !next.startsWith('```')) continue
    const start = lineStart(lines, line)
    const after = lineStart(lines, line + 1)
    const blank = lineText(lines, line - 1).trim() === '' ? '' : '\n'
    found.push(
      candidate(
        'U-197',
        output.slice(0, start) + blank + output.slice(after),
        'the attribute consumed at the list boundary was removed before the next block'
      )
    )
  }
  return found
}

function captionBoundary(output: string, mismatchLine: number): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  const last = mismatchLine > 0 ? Math.min(lines.count, mismatchLine + 12) : lines.count
  for (let line = 2; line <= last; line++) {
    if (!lineText(lines, line).trimStart().startsWith('^ ')) continue
    if (lineText(lines, line - 1).trim() === '') continue
    const at = lineStart(lines, line)
    found.push(
      candidate(
        'U-138',
        output.slice(0, at) + '\n' + output.slice(at),
        'a blank line keeps the caret line separate from the preceding block'
      )
    )
  }
  return found
}

function emptyFootnote(output: string): Candidate[] {
  const found: Candidate[] = []
  let at = output.indexOf('^[')
  while (at >= 0) {
    const close = output.indexOf(']', at + 2)
    if (close >= 0 && output.slice(at + 2, close).trim() === '') {
      found.push(
        candidate(
          'U-139',
          output.slice(0, at) + '\\' + output.slice(at),
          'the empty inline footnote marker was escaped'
        )
      )
    }
    at = output.indexOf('^[', at + 2)
  }
  return found
}

function emptyFootnoteBody(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 1; line <= lines.count; line++) {
    const value = lineText(lines, line)
    const marker = value.indexOf(']: {empty}')
    if (!value.trimStart().startsWith('[^') || marker < 2) continue
    const open = lineStart(lines, line) + marker + 3
    found.push(candidate('U-218', output.slice(0, open) + '{% %}' + output.slice(open + 7),
      'the empty footnote body sentinel was written as an empty brace comment'))
  }
  return found
}

function trailingImageComment(lines: string[], at: number): Candidate | null {
  const value = lines[at] ?? ''
  if (!value.startsWith('![') || !(lines[at + 1] ?? '').trimStart().startsWith('^ ')) return null
  const trailing = value.indexOf(' %%')
  const kept = value.endsWith('{%%}') ? value.slice(0, -4) : trailing > 0 ? value.slice(0, trailing) : null
  if (kept === null) return null
  const shifted = [...lines]
  shifted[at] = kept
  return candidate('U-216', shifted.join('\n'), 'the invisible comment after the block image was removed')
}

function invisibleCommentCandidates(input: string): Candidate[] {
  const lines = input.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length; at++) {
    const value = lines[at] ?? ''
    const trailing = trailingImageComment(lines, at)
    if (trailing !== null) found.push(trailing)
    if (!value.startsWith('{%%}![')) continue
    const changed = [...lines]
    changed[at] = value.slice(4)
    found.push(candidate('U-216', changed.join('\n'), 'the invisible comment before the block image was removed'))
    const above = lines[at - 1] ?? ''
    if (!above.startsWith('{') || !above.endsWith('}')) continue
    changed[at] += above
    changed.splice(at - 1, 1)
    found.push(candidate('U-216', changed.join('\n'), 'the block attribute was moved after its image'))
  }
  const kept = lines.filter((value) => {
    const trimmed = value.trimStart()
    const close = trimmed.indexOf('%}')
    const tail = trimmed.slice(close + 2).trimStart()
    return !trimmed.startsWith('{%') || close < 0 || tail !== '' && !tail.startsWith('%%')
  })
  if (kept.length < lines.length) found.push(candidate('U-216', kept.join('\n'), 'comment-only lines were removed'))
  return found
}

function commentedCaptionCaret(output: string): Candidate[] {
  const found: Candidate[] = []
  const lines = readLines(output)
  for (let line = 2; line <= lines.count; line++) {
    const caret = lineText(lines, line).trimStart()
    if (!caret.startsWith('^ %%') || !lineText(lines, line - 1).trimStart().startsWith('![')) continue
    const at = lineStart(lines, line) + lineText(lines, line).indexOf('^')
    found.push(candidate('U-225', output.slice(0, at) + '\\' + output.slice(at),
      'the caption caret with an empty comment was written literally'))
  }
  return found
}

function displayMathCaption(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 1; at++) {
    const value = lines[at] ?? ''
    if (!value.startsWith('$$`') || value.startsWith('$$``') || !(lines[at + 1] ?? '').startsWith('^ ')) continue
    const close = value.indexOf('`', 3)
    const comment = value.indexOf(' %%', close + 1)
    const changed = [...lines]
    if (close < 0) changed[at] = value + '`'
    else if (comment > close) changed[at] = value.slice(0, comment)
    else continue
    found.push(candidate('U-226', changed.join('\n'), 'the display math line was closed before its caption'))
  }
  return found
}

function percentRunInsideBraceComment(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  let open = false
  for (let at = 0; at < lines.length; at++) {
    const value = lines[at] ?? ''
    if (value.includes('{%')) open = true
    if (open && value.trimStart().startsWith('%%%')) {
      const changed = [...lines]
      changed[at] = value.replace('%%%', '\\%%%')
      found.push(candidate('U-227', changed.join('\n'), 'the percent run inside the brace comment was escaped'))
    }
    if (value.includes('%}')) open = false
  }
  return found
}

function backtickRunInsideBraceComment(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  let open = false
  for (let at = 0; at < lines.length; at++) {
    const value = lines[at] ?? ''
    if (value.includes('{%')) open = true
    const start = value.length - value.trimStart().length
    if (open && value.slice(start).startsWith('```')) {
      const changed = [...lines]
      changed[at] = value.slice(0, start) + '\\' + value.slice(start)
      found.push(candidate('U-243', changed.join('\n'), 'the backtick run inside the brace comment was escaped'))
    }
    if (value.includes('%}')) open = false
  }
  return found
}

function noteItemFollower(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 1; at < lines.length; at++) {
    const head = lines[at - 1] ?? ''
    const follower = lines[at] ?? ''
    if (!head.startsWith('[^') || !head.includes(']: - ') || !follower.startsWith('       ')) continue
    if (!follower.trimStart().startsWith(':::::') && !follower.trimStart().startsWith('^ ')) continue
    const changed = [...lines]
    changed[at] = '      ' + follower.trimStart()
    found.push(candidate('U-229', changed.join('\n'), 'the line after the note item was moved to the note content column'))
  }
  return found
}

function divBoundary(output: string): Candidate[] {
  const lines = readLines(output)
  const found: Candidate[] = []
  for (let line = 2; line <= lines.count; line++) {
    const value = lineText(lines, line)
    if (!value.startsWith(' ')) continue
    const previous = lineText(lines, line - 1).trimStart()
    const opener = previous.startsWith('- ') && value.trimStart().startsWith(':::')
    const follower = previous === ':::' && value.trim() !== ''
    if (!opener && !follower) continue
    const start = lineStart(lines, line)
    found.push(candidate('U-222', output.slice(0, start) + value.trimStart() + output.slice(start + value.length),
      'the div boundary was moved to the 0.2 owning column'))
  }
  return found
}

function foldSmartQuotes(value: string): string {
  return value.replaceAll('“', '"').replaceAll('”', '"').replaceAll('‘', "'").replaceAll('’', "'")
}

function unresolvedSymbolQuote(output: string): boolean {
  return output.split('\n').some((line) => {
    if (!line.startsWith(':')) return false
    const end = line.indexOf(':', 1)
    return end > 1 && (line[end + 1] === '"' || line[end + 1] === "'")
  })
}

function bareQuotePositions(output: string): number[] {
  const positions: number[] = []
  for (let at = 0; at < output.length; at++) {
    if ((output[at] === '"' || output[at] === "'") && output[at - 1] !== '\\') positions.push(at)
  }
  return positions
}

function smartQuoteCandidates(output: string, expected: string): Candidate[] {
  if (!unresolvedSymbolQuote(output) || output.length > 200) return []
  if (!compareHtml(foldSmartQuotes(expected), foldSmartQuotes(html02(output, false))).equal) return []
  const positions = bareQuotePositions(output)
  if (positions.length === 0 || positions.length > 6) return []
  let forms = [output]
  for (const at of positions) {
    const next: string[] = []
    for (const form of forms) {
      const choices = form[at] === '"' ? ['"', '“', '”'] : ["'", '‘', '’']
      for (const quote of choices) next.push(form.slice(0, at) + quote + form.slice(at + 1))
    }
    forms = next
  }
  return forms.filter((form) => form !== output).map((form) =>
    candidate('U-233', form, 'the smart quote direction was written with a literal curly quote'))
}

function unresolvedReferenceBackslashes(output: string): Candidate[] {
  if (!output.includes('][')) return []
  const found: Candidate[] = []
  for (let at = 0; at < output.length; at++) {
    if (output[at] !== '\\' || output[at - 1] === '\\') continue
    let end = at
    while (output[end] === '\\') end++
    if (end - at > 8 || output[end] !== '^' && output[end] !== '\n') continue
    found.push(candidate('U-234', output.slice(0, at) + '\\\\' + output.slice(at),
      'the unresolved reference keeps the 0.1 literal backslash run'))
  }
  return found
}

function nestedDefinitionBoundary(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 2; at++) {
    const head = lines[at] ?? ''
    const marker = head.indexOf(' [')
    if (!head.startsWith('* * ') || marker < 0 || !head.includes(']:', marker)) continue
    const changed = [...lines]
    changed[at] = head.slice(0, marker + 1) + '{% %}'
    const next = lines[at + 1] ?? ''
    if (next.trim() === ':') changed.splice(at + 1, 0, '')
    else if (next === '%%' && (lines[at + 2] ?? '').trim() === ':') changed[at + 1] = ''
    else continue
    found.push(candidate('U-235', changed.join('\n'),
      'the consumed definition became an empty comment and the colon kept its 0.1 boundary'))
  }
  return found
}

function nestedItemFollower(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 1; at < lines.length; at++) {
    const previous = lines[at - 1] ?? ''
    if (!previous.startsWith('  - ') && !previous.startsWith('  * ')
      && !previous.startsWith('  1. ')) continue
    const current = lines[at] ?? ''
    if (!current.startsWith('   ') || current.trim() === '') continue
    for (const indent of [2, 1]) {
      const changed = [...lines]
      changed[at] = ' '.repeat(indent) + current.trimStart()
      found.push(candidate('U-237', changed.join('\n'),
        'the follower was moved to its outer item content column'))
    }
  }
  return found
}

function listFenceContinuation(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 4; at++) {
    if (!(lines[at] ?? '').startsWith('- ```') || (lines[at + 2] ?? '') !== ''
      || (lines[at + 3] ?? '') !== '+' || (lines[at + 4] ?? '').trim() === '') continue
    const changed = [...lines]
    changed[at + 3] = '  ```'
    changed[at + 4] = '  ' + (lines[at + 4] ?? '').trimStart()
    found.push(candidate('U-238', changed.join('\n'),
      'the continuation became an explicit fence closer under the list item'))
  }
  return found
}

function descriptionFenceDedent(output: string): Candidate[] {
  const lines = output.split('\n')
  const found: Candidate[] = []
  for (let at = 0; at < lines.length - 3; at++) {
    if (!(lines[at] ?? '').startsWith(':: ') || !(lines[at + 1] ?? '').startsWith(': ')) continue
    if (!(lines[at + 2] ?? '').startsWith('\t```') || !(lines[at + 3] ?? '').startsWith(' ```')) continue
    const changed = [...lines]
    changed[at + 3] = (lines[at + 3] ?? '').trimStart()
    found.push(candidate('U-239', changed.join('\n'),
      'the following fence was moved outside the description'))
  }
  return found
}

/** Clause-backed spellings found by a bounded full HTML check. */
export function rescueMinor(
  input: string,
  output: string,
  mismatch: ReportRecord
): { output: string; record: ReportRecord } | null {
  const expected = html01(input)
  const candidates = [
    ...trailingFence(output),
    ...indentedFenceRunAsContent(output),
    ...blockAttributeAcrossFootnote(output),
    ...quotedItemFenceBlank(output),
    ...unresolvedFootnoteHeadingId(output),
    ...tableAfterOrderedItem(output),
    ...nestedFootnoteFence(output),
    ...closeDivBeforeFootnote(output),
    ...inlineComment(output),
    ...emptyItemAttribute(output),
    ...emptyDescriptionSentinels(output),
    ...quotedAttribute(output),
    ...multilineQuotedAttribute(output),
    ...conflictingListStart(output),
    ...consumedListAttribute(output),
    ...captionBoundary(output, mismatch.line),
    ...emptyFootnote(output),
    ...emptyFootnoteBody(output),
    ...invisibleCommentCandidates(input),
    ...commentedCaptionCaret(output),
    ...displayMathCaption(output),
    ...percentRunInsideBraceComment(output),
    ...backtickRunInsideBraceComment(output),
    ...noteItemFollower(output),
    ...divBoundary(output),
    ...smartQuoteCandidates(output, expected),
    ...unresolvedReferenceBackslashes(output),
    ...nestedDefinitionBoundary(output),
    ...nestedItemFollower(output),
    ...listFenceContinuation(output),
    ...descriptionFenceDedent(output)
  ]
  for (const item of candidates) {
    try {
      if (!compareHtml(expected, html02(item.output, false)).equal) continue
      return { output: item.output, record: recordOf(item.entry, Math.max(1, mismatch.line), item.message) }
    } catch {
      /* A candidate can fail to parse under the new grammar. */
    }
  }
  return null
}
