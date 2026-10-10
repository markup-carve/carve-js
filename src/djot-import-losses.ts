import { djotDestinationLines } from './djot-destination-lines.js'
import { djotEmphasis } from './djot-emphasis.js'
import { djotInlineBoundaries, isDjotEscaped, maskDjotCodeAndDestinations } from './djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'
import { parse } from './parse.js'
import { renderPlainText } from './render-plain.js'

export type DjotImportLoss = {
  code: 'structure-unspellable'
  message: string
  line: number
}

const referenceKey = (label: string): string =>
  label
    .replace(/\\([ \t!-\/:-@\[-`{-~])/g, '$1')
    .trim()
    .replace(/\s+/g, ' ')

/** Detect losses before any rewrite can move a source line. */
export function djotImportLosses(
  source: string,
  rows: readonly boolean[],
  contentStart: (line: string) => number,
): DjotImportLoss[] {
  const losses: DjotImportLoss[] = []
  const reported = new Set<string>()
  const lines = source.split('\n')
  const quoteDepths = lines.map(line => (line.match(/^(?:[ \t]*>(?:[ \t]|$))*/)?.[0].match(/>/g) ?? []).length)
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }
  const lineAt = (at: number): number => {
    let low = 0,
      high = offsets.length
    while (low + 1 < high) {
      const mid = (low + high) >>> 1
      if (offsets[mid]! <= at) low = mid
      else high = mid
    }
    return low + 1
  }
  const report = (message: string, line: number): void => {
    const key = `${line}:${message}`
    if (!reported.has(key)) {
      reported.add(key)
      losses.push({ code: 'structure-unspellable', message, line })
    }
  }
  djotEmphasis(
    source,
    (text) => text,
    (at) => report('Emphasis exceeding the native nesting budget is flattened; its text is preserved.', lineAt(at)),
  )
  const destinations = new Map<number, number>()
  const masked = maskDjotCodeAndDestinations(source, false, true, false, undefined, [], { destinations: true, autolinks: true, comments: true, onDestination: (start, end) => destinations.set(start, end) }).split('')
  for (let at = 0; at < source.length; at++) {
    if (masked[at] !== '{' || isDjotEscaped(source, at)) continue
    const attrs = readAttributes(source, at)
    if (!attrs) continue
    for (let k = at; k < attrs.end; k++) if (masked[k] !== '\n') masked[k] = ' '
    at = attrs.end - 1
  }
  const definitions = new Map<string, string>()
  const definitionLines = new Set<number>()
  const headingLines = new Set<number>()
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!,
      visible = masked.slice(offsets[n]!, offsets[n]! + line.length).join('')
    const at = contentStart(line),
      content = line.slice(at),
      contentMask = visible.slice(at)
    const definition = /^\[([^\[\]\n^]+)\]:[ \t]*(\S*)[ \t]*$/.exec(content)
    const previous = lines[n - 1] ?? ''
    const previousContent = previous.slice(contentStart(previous)).trim()
    const item = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.test(line.slice(0, at))
    const boundary =
      previousContent === '' ||
      rows[n - 1] ||
      item ||
      definitionLines.has(n - 1) ||
      /^(?:#{1,6}(?: |$)|:{3,}|[`~]{3,}|\{|\[[^\]]+\]:)/.test(previousContent) ||
      /^(?:[*-][ \t]*){3,}$/.test(previousContent) ||
      (contentStart(previous) > at &&
        /(?:>|[-*+] |[0-9A-Za-z]+[.)] |\([0-9A-Za-z]+\) )/.test(previous.slice(0, contentStart(previous))))
    if (definition && contentMask.startsWith('[') && boundary) {
      let destination = definition[2]!
      for (
        let next = n + 1;
        next < lines.length &&
        contentStart(lines[next]!) > at &&
        /^\S+$/.test(lines[next]!.slice(contentStart(lines[next]!)));
        next++
      ) {
        destination += lines[next]!.slice(contentStart(lines[next]!))
        definitionLines.add(next)
      }
      definitions.set(referenceKey(definition[1]!), destination)
      definitionLines.add(n)
      for (let k = offsets[n]!; k < offsets[n]! + line.length; k++) masked[k] = ' '
    }
    const heading = /^(#{1,6})(?:[ \t]+|$)/.exec(contentMask)
    if (heading && boundary && !headingLines.has(n)) {
      let text = content.slice(heading[0].length)
      let lastPart = text
      const marker = new RegExp(`^${heading[1]}[ \\t]+`)
      for (let next = n + 1; next < lines.length; next++) {
        const following = lines[next]!
        const prefix = following.slice(0, contentStart(following))
        if (
          (prefix.match(/>/g) ?? []).length !== (line.slice(0, at).match(/>/g) ?? []).length ||
          /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.test(prefix)
        )
          break
        const part = following.slice(contentStart(following))
        if (!part.trim() || /(?:^|[^\\])(?:\\\\)*\\$/.test(lastPart)) break
        if (marker.test(part)) { lastPart = part.replace(marker, ''); text += '\n' + lastPart }
        else {
          if (
            /^(?:[#>|{]|[-*+][ \t]|[0-9A-Za-z]+[.)][ \t]|:[ \t]|:{2,}|\([0-9a-zA-Z]+\)[ \t]|[`~]{3,}|\[[^\]\n]*\]:|(?:[*-][ \t]*){3,}$)/.test(
              part,
            )
          )
            break
          lastPart = part
          text += '\n' + part
        }
        headingLines.add(next)
      }
      const label = renderPlainText(parse(djotEmphasis(text, (text) => text)), {
        smartTypography: false,
      })
      const key = referenceKey(label)
      if (!definitions.has(key)) definitions.set(key, '#' + key)
    }
    if (/^#{1,6}[ \t]*$/.test(contentMask) && boundary && !headingLines.has(n)) {
      const next = lines[n + 1]?.trim() ?? ''
      if (next === '' || /^(?:[#>|{]|[-*+] |:{3,}|`{3,}|~{3,})/.test(next))
        report('An empty heading cannot be spelled in Carve.', n + 1)
    }
    const term = /:[ \t]+$/.exec(visible.slice(0, at))
    if (
      term &&
      (term.index === 0 || /[ \t]/.test(visible[term.index - 1]!)) &&
      /^\S/.test(contentMask) &&
      (previousContent === '' || n === 0 || item)
    ) {
      const quoteDepth = (line.slice(0, at).match(/>/g) ?? []).length
      const inContainer = (next: string): boolean =>
        (next.slice(0, contentStart(next)).match(/>/g) ?? []).length === quoteDepth
      const blank = (next: string): boolean => next.slice(contentStart(next)).trim() === ''
      const withoutQuotes = (next: string): string => {
        const lastQuote = next.slice(0, contentStart(next)).lastIndexOf('>')
        return lastQuote < 0 ? next : next.slice(lastQuote + 1).replace(/^[ \t]/, '')
      }
      const minimum = withoutQuotes(line.slice(0, term.index)).length + 2
      const continuesTerm = (next: string): boolean => {
        const content = withoutQuotes(next)
        return (
          !/^[ \t]*(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\)|:)[ \t]+/.test(content) ||
          /^[ \t]*/.exec(content)![0].length > minimum - 2
        )
      }
      let end = n + 1
      while (end < lines.length && inContainer(lines[end]!) && !blank(lines[end]!) && continuesTerm(lines[end]!)) end++
      while (end < lines.length && blank(lines[end]!)) end++
      if (
        end === lines.length ||
        !inContainer(lines[end]!) ||
        /^[ \t]*/.exec(withoutQuotes(lines[end]!))![0].length < minimum
      ) {
        report('An empty definition description cannot be spelled in Carve.', n + 1)
      }
    }
    if (!rows[n]) continue
    const separator = /^\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*$/.test(content)
    if (separator && rows[n - 1] && rows[n - 2])
      report('A separator inside a table promotes another header row; Carve cannot spell it.', n + 1)
    if (separator && !rows[n - 1]) {
      let end = n
      while (rows[end] && /^\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*$/.test(lines[end]!.slice(contentStart(lines[end]!))))
        end++
      if (!rows[end]) report('A table containing only separator rows cannot be spelled in Carve.', n + 1)
    }
    if (/^\|(?:[ \t]*\|)+[ \t]*$/.test(content))
      report('A table row whose cells are all blank cannot be spelled in Carve.', n + 1)
  }
  const escaped = new Uint8Array(source.length)
  let slashes = 0
  for (let at = 0; at < source.length; at++) {
    escaped[at] = slashes % 2
    slashes = source[at] === '\\' ? slashes + 1 : 0
  }
  const boundaries = djotInlineBoundaries(source, masked.join(''))
  const breaks = new Set(boundaries)
  const referenceEnds = new Int32Array(source.length + 1).fill(-1)
  let next = -1
  for (let at = source.length - 1; at >= 0; at--) {
    if (breaks.has(at)) next = -1
    else if (masked[at] === ']' && !escaped[at]) next = at
    else if (masked[at] === '[' && !escaped[at]) next = -1
    referenceEnds[at] = next
  }
  const stack: { at: number; nested: boolean }[] = []
  const carryNested = (nested: boolean): void => {
    const parent = stack.at(-1)
    if (nested && parent) parent.nested = true
  }
  let boundary = 0
  for (let at = 0; at < source.length; at++) {
    while ((boundaries[boundary] ?? source.length) <= at) {
      stack.length = 0
      boundary++
    }
    if (masked[at] !== source[at] || escaped[at]) continue
    if (source[at] === '[') {
      stack.push({ at, nested: false })
      continue
    }
    if (source[at] !== ']') continue
    const opener = stack.pop()
    if (opener === undefined) continue
    if (source[opener.at + 1] === '^') { carryNested(opener.nested); continue }
    const open = opener.at
    const image = source[open - 1] === '!' && !escaped[open - 1]
    let end = at + 1,
      destination: string | undefined
    if (source[end] === '(') {
      const destinationEnd = destinations.get(end)
      if (destinationEnd === undefined) { carryNested(opener.nested); continue }
      destination = djotDestinationLines(source.slice(end + 1, destinationEnd - 1), quoteDepths[lineAt(open) - 1]!)
      end = destinationEnd
    } else if (source[end] === '[') {
      const start = end + 1
      end = referenceEnds[start]!
      if (end < 0) { carryNested(opener.nested); continue }
      const explicit = source.slice(start, end)
      const label = source.slice(open + 1, at)
      const key = referenceKey(
        explicit ||
          (definitions.size === 0 ? '' : renderPlainText(parse(djotEmphasis(label, (text) => text)), {
            smartTypography: false,
          })),
      )
      destination = definitions.get(key)
      end++
      if (destination === undefined)
        report(image ? 'An unresolved Djot image reference has no src; Carve cannot spell that image.' : 'An unresolved Djot reference has no href; Carve cannot spell that link.', lineAt(open))
    } else { carryNested(opener.nested); continue }
    if (destination === '')
      report(image ? 'An image with an empty destination cannot be spelled in Carve.' : 'A link with an empty destination cannot be spelled in Carve.', lineAt(open))
    if (!image) {
      if (opener.nested) report('A link inside another link cannot be spelled in Carve.', lineAt(open))
      const parent = stack.at(-1)
      if (parent) parent.nested = true
    }
    at = end - 1
  }
  return losses.sort((a, b) => a.line - b.line)
}
