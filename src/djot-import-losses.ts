import { djotEmphasis } from './djot-emphasis.js'
import { isDjotEscaped, maskDjotCodeAndDestinations } from './djot-migrate.js'
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
  const lines = source.split('\n')
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
    if (!losses.some((loss) => loss.line === line && loss.message === message))
      losses.push({ code: 'structure-unspellable', message, line })
  }
  djotEmphasis(
    source,
    (text) => text,
    (at) => report('Nested same-kind emphasis is flattened; Carve cannot spell it.', lineAt(at)),
  )
  const masked = maskDjotCodeAndDestinations(source, false, true, false, undefined, [], { destinations: true, autolinks: true, comments: true }).split('')
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
        if (!part.trim() || /(?:^|[^\\])(?:\\\\)*\\$/.test(text)) break
        if (marker.test(part)) text += '\n' + part.replace(marker, '')
        else {
          if (
            /^(?:[#>|{]|[-*+][ \t]|[0-9A-Za-z]+[.)][ \t]|:[ \t]|:{2,}|\([0-9a-zA-Z]+\)[ \t]|[`~]{3,}|\[[^\]\n]*\]:|(?:[*-][ \t]*){3,}$)/.test(
              part,
            )
          )
            break
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
  const links: { open: number; close: number; end: number; image: boolean }[] = []
  const stack: number[] = []
  for (let at = 0; at < source.length; at++) {
    if (source[at] === '\n' && /^\n[ \t]*\n/.test(source.slice(at))) stack.length = 0
    if (masked[at] !== source[at] || isDjotEscaped(source, at)) continue
    if (source[at] === '[') {
      stack.push(at)
      continue
    }
    if (source[at] !== ']') continue
    const open = stack.pop()
    if (open === undefined || source[open + 1] === '^') continue
    const image = source[open - 1] === '!' && !isDjotEscaped(source, open - 1)
    let end = at + 1,
      destination: string | undefined
    if (source[end] === '(') {
      const start = ++end
      let depth = 1
      while (end < source.length && depth > 0) {
        if (source[end] === '\\') {
          end += 2
          continue
        }
        if (source[end] === '(') depth++
        if (source[end] === ')') depth--
        if (depth > 0) end++
      }
      if (depth) continue
      destination = source.slice(start, end).trim()
      end++
    } else if (source[end] === '[') {
      const start = ++end
      while (end < source.length && source[end] !== ']' && !/^\n[ \t]*\n/.test(source.slice(end))) {
        if (source[end] === '\\') end++
        end++
      }
      if (source[end] !== ']') continue
      const explicit = source.slice(start, end)
      const label = source.slice(open + 1, at)
      const key = referenceKey(
        explicit ||
          renderPlainText(parse(djotEmphasis(label, (text) => text)), {
            smartTypography: false,
          }),
      )
      destination = definitions.get(key)
      end++
      if (destination === undefined && !image)
        report('An unresolved Djot reference has no href; Carve cannot spell that link.', lineAt(open))
    } else continue
    if (destination === '' && !image)
      report('A link with an empty destination cannot be spelled in Carve.', lineAt(open))
    links.push({ open, close: at, end, image })
    at = end - 1
  }
  for (const outer of links) {
    if (outer.image) continue
    if (links.some((inner) => !inner.image && inner.open > outer.open && inner.end <= outer.close)) {
      report('A link inside another link cannot be spelled in Carve.', lineAt(outer.open))
    }
  }
  return losses.sort((a, b) => a.line - b.line)
}
