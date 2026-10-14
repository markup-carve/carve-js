import { djotBlockLayout } from './djot-block-layout.js'
import { djotItemPrefix } from './djot-inline-boundaries.js'
import { djotDestinationLines } from './djot-destination-lines.js'
import { djotEmphasis } from './djot-emphasis.js'
import { djotInlineBoundaries, isDjotEscaped, maskDjotCodeAndDestinations } from './djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'
import { djotCollapsedReferenceCache } from './djot-collapsed-reference.js'
import { backtickRunEnds } from './backtick-run-index.js'

export type DjotImportLoss = {
  code: 'structure-unspellable'
  message: string
  line: number
}

const definitionKey = (label: string): string => label.trim().replace(/[ \t\r\n]+/g, ' ')
const referenceKey = (label: string): string =>
  definitionKey(label.replace(/\\([ \t!-\/:-@\[-`{-~])/g, '$1'))

/** Detect losses before any rewrite can move a source line. */
export function djotImportLosses(
  source: string,
  rows: readonly boolean[],
  contentStart: (line: string) => number,
  rawCode: readonly number[] = [],
  accepted: ReadonlyMap<number, { label: string; target: string; end: number }>,
  definitionsOnly?: Map<string, string>,
): DjotImportLoss[] {
  const collapsedReferenceText = djotCollapsedReferenceCache()
  const losses: DjotImportLoss[] = []
  const reported = new Set<string>()
  const lines = source.split('\n')
  const quoteDepths = lines.map(line => (line.slice(0, contentStart(line)).match(/>/g) ?? []).length)
  if (quoteDepths.some(depth => depth > 0))
    djotBlockLayout(source, rows, undefined, undefined, undefined, undefined, (line, depth) => { quoteDepths[line] = depth })
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
  for (const at of rawCode) report('Multiline inline code uses raw HTML; plain-text export omits it.', lineAt(at))
  const codeMask = maskDjotCodeAndDestinations(source, false, false, false, undefined, [], { code: false })
  const codeEnds = backtickRunEnds(codeMask)
  if (codeEnds) for (let at = 0; at < source.length; at++) {
    if (source[at] !== '`' || codeMask[at] !== '`') continue
    if (/^[ \t]*>/.test(source.slice(source.lastIndexOf('\n', at - 1) + 1, at))) continue
    const end = codeEnds[at]!
    if (end < 0) continue
    const content = source.slice(at + 1, end - 1)
    if (/\n[ \t]*:{3,}(?:[ \t]+[^\n]*)?(?:\n|$)/.test(content))
      report('A multiline code span contains a Carve container opener on a continuation line.', lineAt(at))
    at = end - 1
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
    if (definitionLines.has(n)) continue
    const line = lines[n]!,
      visible = masked.slice(offsets[n]!, offsets[n]! + line.length).join('')
    const at = contentStart(line),
      content = line.slice(at),
      contentMask = visible.slice(at)
    const previous = lines[n - 1] ?? ''
    const previousContent = previous.slice(contentStart(previous)).trim()
    const item = /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.test(djotItemPrefix(line, at))
    const boundary =
      previousContent === '' ||
      rows[n - 1] ||
      item ||
      definitionLines.has(n - 1) ||
      /^(?:#{1,6}(?: |$)|:{3,}|[`~]{3,}|\{|\[[^\]]+\]:)/.test(previousContent) ||
      /^(?:[*-][ \t]*){3,}$/.test(previousContent) ||
      (contentStart(previous) > at &&
        /(?:>|[-*+] |[0-9A-Za-z]+[.)] |\([0-9A-Za-z]+\) )/.test(djotItemPrefix(previous, contentStart(previous))))
    const decision = accepted.get(n)
    if (decision) {
      for (let next = n + 1; next <= decision.end; next++) definitionLines.add(next)
      definitions.set(definitionKey(decision.label), decision.target)
      definitionLines.add(n)
      for (let k = offsets[n]!; k < offsets[n]! + line.length; k++) masked[k] = ' '
    }
    const heading = contentMask.startsWith('#') ? /^(#{1,6})(?:[ \t]+|$)/.exec(content) : null
    if (heading && boundary && !headingLines.has(n)) {
      let text = content.slice(heading[0].length)
      let lastPart = text
      const marker = new RegExp(`^${heading[1]}[ \\t]+`)
      for (let next = n + 1; next < lines.length; next++) {
        const following = lines[next]!
        const prefix = following.slice(0, contentStart(following))
        if (
          (prefix.match(/>/g) ?? []).length !== (line.slice(0, at).match(/>/g) ?? []).length ||
          /(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.test(djotItemPrefix(following, contentStart(following)))
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
      const label = collapsedReferenceText(text)
      const key = definitionKey(label)
      let target = '#' + key.replace(/[ \t\r\n]+/g, '-')
      for (let prior = n - 1; prior >= 0; prior--) {
        const value = lines[prior]!.slice(contentStart(lines[prior]!)).trim()
        const attrs = value.startsWith('{') ? readAttributes(value, 0) : undefined
        if (!attrs || attrs.end !== value.length) break
        let id: (typeof attrs.tokens)[number] | undefined
        for (const token of attrs.tokens) if (token.key === 'id') id = token
        if (id) {
          const idValue = id.source.startsWith('#') ? id.source.slice(1) : id.source.slice(3).replace(/^"|"$/g, '').replace(/\\([\\"])/g, '$1')
          target = '#' + idValue
          break
        }
      }
      if (!definitions.has(key)) definitions.set(key, target)
    }
    if (/^#{1,6}[ \t]*$/.test(contentMask) && heading && collapsedReferenceText(content.slice(heading[0].length)).trim() === '' && boundary && !headingLines.has(n)) {
      const next = lines[n + 1]?.trim() ?? ''
      if (next === '' || /^(?:[#>|{]|[-*+] |:{3,}|`{3,}|~{3,})/.test(next))
        report('An empty heading cannot be spelled in Carve.', n + 1)
    }
    if (/^(?:[ \t]*>[ \t]*)*:[ \t]*$/.test(line) && boundary && masked[offsets[n]! + line.indexOf(':')] === ':')
      report('A definition item with an empty term cannot be spelled in Carve.', n + 1)
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
    // A row of blank cells is a Carve row (CARVE-P9-082), but Carve reads a tab
    // between the pipes as content where Djot reads padding.
    if (/^\|(?:[ \t]*\|)+[ \t]*$/.test(content) && content.trimEnd().includes('\t'))
      report('A blank table cell holding a tab reads as tab content in Carve.', n + 1)
  }
  if (definitionsOnly) {
    for (const [key, target] of definitions) definitionsOnly.set(key, target)
    return losses
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
    if (source[opener.at + 1] === '^' && at > opener.at + 2) { carryNested(opener.nested); continue }
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
      const key = explicit ? referenceKey(explicit) : definitionKey(
        definitions.size === 0 ? '' : collapsedReferenceText(label, quoteDepths[lineAt(open) - 1]!),
      )
      destination = definitions.get(key)
      end++
      if (destination === undefined) {
        report(image ? 'An unresolved Djot image reference has no src; Carve cannot spell that image.' : 'An unresolved Djot reference has no href; Carve cannot spell that link.', lineAt(open))
      }
    } else { carryNested(opener.nested); continue }
    if (destination === '')
      report(image ? 'An image with an empty destination cannot be spelled in Carve.' : 'A link with an empty destination cannot be spelled in Carve.', lineAt(open))
    if (image && destination !== undefined && destination !== '') {
      const label = source.slice(open + 1, at)
      if (label.includes('\n') && /\n[ \t]*\n/.test(collapsedReferenceText(label, quoteDepths[lineAt(open) - 1]!)))
        report('An image alternative text with a blank line cannot be spelled in Carve.', lineAt(open))
      if (/[ \t]+\n/.test(label))
        report('An image alternative text loses trailing spaces before a line break.', lineAt(open))
    }
    if (!image) {
      if (opener.nested) report('A link inside another link cannot be spelled in Carve.', lineAt(open))
      const parent = stack.at(-1)
      if (parent) parent.nested = true
    }
    at = end - 1
  }
  return losses.sort((a, b) => a.line - b.line)
}
