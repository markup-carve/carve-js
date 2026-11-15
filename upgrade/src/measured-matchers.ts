function lineStarts(input: string, prefixes: readonly string[]): boolean {
  return input.split('\n').some((line) => prefixes.some((prefix) => line.trimStart().startsWith(prefix)))
}

function divNameHasBracket(input: string): boolean {
  return input.split('\n').some((line) => line.trimStart().startsWith('::: ') && line.includes('['))
}

function titledFenceHasTail(input: string): boolean {
  return input.split('\n').some((line) => {
    if (!line.trimStart().startsWith('```')) return false
    const lastQuote = line.lastIndexOf('"')
    const tail = line.slice(lastQuote + 1).trim()
    return lastQuote >= 0 && tail !== '' && isNameCode(tail.charCodeAt(0))
  })
}

function fenceInfoHasBacktick(input: string): boolean {
  return input.split('\n').some((line) => {
    const value = line.trimStart()
    if (!value.startsWith('```')) return false
    let run = 0
    while (value.charCodeAt(run) === 0x60) run++
    return value.slice(run).includes('`')
  })
}

function hasLongDash(input: string): boolean {
  let run = 0
  for (let at = 0; at < input.length; at++) {
    run = input.charCodeAt(at) === 0x2d ? run + 1 : 0
    if (run >= 7) return true
  }
  return false
}

function isNameCode(code: number): boolean {
  return code >= 0x61 && code <= 0x7a || code >= 0x41 && code <= 0x5a || code >= 0x30 && code <= 0x39
}

function hasTrailingSigil(input: string): boolean {
  for (let at = 0; at < input.length; at++) {
    const code = input.charCodeAt(at)
    if (code !== 0x23 && code !== 0x40) continue
    let end = at + 1
    while (isNameCode(input.charCodeAt(end))) end++
    if (end === at + 1 || input.charCodeAt(end) !== 0x2d) continue
    const next = input.charCodeAt(end + 1)
    if (next === 0x23 || next === 0x40 || next <= 0x20 || Number.isNaN(next)) return true
  }
  return false
}

function blockMatch(input: string): string | null {
  if (input.includes('{loose}') && input.includes('::')) return 'U-172'
  if (input.includes('\r') && lineStarts(input, ['# '])) return 'U-176'
  if (lineStarts(input, ['# \t', '## \t', '### \t'])) return 'U-174'
  if (divNameHasBracket(input)) return 'U-156'
  if (titledFenceHasTail(input) || fenceInfoHasBacktick(input)) return 'U-157'
  if (lineStarts(input, ['-  [', '*  [', '.  ['])) return 'U-163'
  if (lineStarts(input, ['-{', '*{', '.{']) && input.includes('} {')) return 'U-169'
  return null
}

function changedTaskLabel(input: string, expected: string, actual: string): boolean {
  const task = lineStarts(input, ['- [x]', '- [X]', '- [ ]', '* [x]', '* [ ]', '. [x]', '. [ ]'])
  return task && expected.includes('aria-label=') && actual.includes('aria-label=')
}

function tableMetadataMatch(input: string): string | null {
  if (input.includes('{widths=') || input.includes('{body-rows=') || input.includes('{body-header-rows=')
    || input.includes('{header-rows=') || input.includes('{footer-rows=') || input.includes(' body-header-cols=')) return 'U-150'
  if (input.includes('?v') || input.includes('{?')) return 'U-162'
  return null
}

function tableMarkMatch(input: string): string | null {
  if (lineStarts(input, ['+']) && input.includes('|')) return 'U-147'
  if (input.includes('|{') && input.includes('}|')) return 'U-165'
  if (input.includes('|:') && input.includes('|=')) return 'U-167'
  if (input.includes('|=|') || input.includes('|= ') || lineStarts(input, ['|=', '||='])) return 'U-168'
  if (input.includes('<|') || input.includes('| ^') || input.includes('|^')) return 'U-152'
  return null
}

function tableMatch(input: string): string | null {
  if (!lineStarts(input, ['|', '+'])) return null
  return tableMetadataMatch(input) ?? tableMarkMatch(input)
}

function footnoteReferenceMatch(input: string, expected: string, actual: string): string | null {
  if (input.includes('[^') && expected.includes('<sup') && actual.includes('role="doc-noteref"')) return 'U-154'
  if (input.includes('^[') && input.includes('[^') && actual.includes('<a')) return 'U-154'
  const footnote = input.indexOf('[^')
  const footnoteEnd = input.indexOf(']', footnote + 2)
  if (footnote >= 0 && footnoteEnd > footnote && input.slice(footnote, footnoteEnd).includes('\n')) return 'U-160'
  return null
}

function wrappedBracket(input: string, open: number): boolean {
  if (open < 0) return false
  const close = input.indexOf(']', open + 1)
  return close > open && input.slice(open + 1, close).includes('\n')
}

function imageReferenceMatch(input: string, expected: string, actual: string): string | null {
  if (input.includes('![') && input.includes('](') && wrappedBracket(input, input.indexOf('![') + 1)) return 'U-171'
  if (input.includes('][') && wrappedBracket(input, input.indexOf('][') + 1) && expected.includes('[')) return 'U-161'
  if (input.includes('][{') && actual.includes('[')) return 'U-158'
  return null
}

function referenceMatch(input: string, expected: string, actual: string): string | null {
  if (input.includes('javascript:') || input.includes('\u202e')) return 'U-164'
  if (input.includes('][@')) return 'U-166'
  const footnote = footnoteReferenceMatch(input, expected, actual)
  if (footnote !== null) return footnote
  const image = imageReferenceMatch(input, expected, actual)
  if (image !== null) return image
  if (input.includes(']( ') || input.includes('](  ')) return 'U-175'
  return null
}

function inlinePunctuationMatch(input: string, expected: string): string | null {
  if (hasLongDash(input)) return 'U-173'
  if (hasTrailingSigil(input) && (expected.includes('class="mention"') || expected.includes('class="tag"')
    || expected.includes('<strong>#') || expected.includes('<strong>@'))) return 'U-170'
  if (input.includes(':') && input.includes('[%%')) return 'U-149'
  if (input.includes('[ %%') || input.includes('[%%')) return 'U-146'
  if (input.includes('{^') || input.includes('\t%%')) return 'U-155'
  return null
}

function listMarkerTab(input: string, expected: string, actual: string): boolean {
  if (!expected.includes('\t') || actual.includes('\t')) return false
  return input.split('\n').some((line) => line.includes('- \t') || line.includes('* \t')
    || line.includes('. \t') || line.includes('.\t'))
}

function adjacentBracedDelimiter(input: string): boolean {
  const source = input.trimStart()
  return ['/{', '{*', '{_', '{~', '{=', '{+', '{-'].some((prefix) => source.startsWith(prefix))
}

function inlineDelimiterMatch(input: string, expected: string, actual: string): string | null {
  if ((input.includes('{+') || input.includes('{-')) && input.includes('"')) return 'U-144'
  if (!input.includes('`') && !input.includes('%%') && (input.includes('/*') || input.includes('*/'))) return 'U-145'
  if (input.includes('_{') || input.includes('~{')) return 'U-151'
  if (adjacentBracedDelimiter(input) && (expected.includes('<em>') || expected.includes('<strong>'))) return 'U-143'
  if (actual.includes('<em>') && adjacentBracedDelimiter(input)) return 'U-143'
  return null
}

function inlineMatch(input: string, expected: string, actual: string): string | null {
  return inlinePunctuationMatch(input, expected) ?? inlineDelimiterMatch(input, expected, actual)
}

/** The narrow syntax shapes of measured report-only changes. */
export function matchMeasured(input: string, expected: string, actual: string): string | null {
  if (changedTaskLabel(input, expected, actual)) return 'U-159'
  const table = tableMatch(input)
  if (table !== null) return table
  const reference = referenceMatch(input, expected, actual)
  if (reference !== null) return reference
  const block = blockMatch(input)
  if (block !== null) return block
  if (lineStarts(input, ['# ']) && (input.includes('][') || input.includes('%%'))) return 'U-148'
  const inline = inlineMatch(input, expected, actual)
  if (inline !== null) return inline
  if (listMarkerTab(input, expected, actual)) return 'U-153'
  return null
}
