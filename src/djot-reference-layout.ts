import { djotEmphasis } from './djot-emphasis.js'
import { isDjotEscaped, maskDjotCodeAndDestinations } from './djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'
import { parse } from './parse.js'
import { renderPlainText } from './render-plain.js'

const referenceKey = (label: string): string =>
  label
    .replace(/\\([ \t!-\/:-@\[-`{-~])/g, '$1')
    .trim()
    .replace(/\s+/g, ' ')

function referenceMask(source: string): string {
  const mask = maskDjotCodeAndDestinations(source, false, true, false).split('')
  for (let at = 0; at < source.length; at++) {
    if (mask[at] !== '{' || isDjotEscaped(source, at)) continue
    const attrs = readAttributes(source, at)
    if (!attrs) continue
    for (let k = at; k < attrs.end; k++) if (mask[k] !== '\n') mask[k] = ' '
    at = attrs.end - 1
  }
  return mask.join('')
}

/** Normalize reference labels and carry definition attributes to each use. */
export function djotReferenceLayout(source: string, contentStart: (line: string) => number): string {
  let mask = referenceMask(source)
  source = source.replace(
    /(!?\[)([^\[\]]*\n[^\[\]]*)(\])(?=\[)/g,
    (all: string, open: string, label: string, close: string, at: number) =>
      mask[at] !== ' ' &&
      !isDjotEscaped(source, at) &&
      !label.startsWith('^') &&
      !label.includes('`') &&
      !/\n[ \t]*\n/.test(label)
        ? open + label.replace(/\s*\n\s*/g, ' ') + close
        : all,
  )
  mask = referenceMask(source)
  const labels = new Set(
    source.split('\n').flatMap((line) => {
      const definition = /^\[([^\[\]\n^]+)\]:/.exec(line.slice(contentStart(line)))
      return definition ? [referenceKey(definition[1]!)] : []
    }),
  )
  source = source.replace(
    /(\]\[)([^\[\]]*\n[^\[\]]*)(\])/g,
    (all: string, open: string, label: string, close: string, at: number) =>
      mask[at] === ']' && !/\n[ \t]*\n/.test(label) && labels.has(referenceKey(label))
        ? open + label.replace(/\s+/g, ' ').trim() + close
        : all,
  )
  const lines = source.split('\n')
  const definitions = new Map<string, { target: string; attrs: string; line: number; first: number }>()
  const definitionMask = referenceMask(source).split('\n')
  const definitionLines = new Set<number>()
  for (let n = 0; n < lines.length; n++) {
    const start = contentStart(lines[n]!)
    const definition = /^\[([^\[\]\n^]+)\]:[ \t]*(\S*)[ \t]*$/.exec(lines[n]!.slice(start))
    if (!definition || definitionMask[n]![start] !== '[') continue
    let first = n
    const attrs: string[] = []
    while (first > 0) {
      const preceding = lines[first - 1]!.slice(contentStart(lines[first - 1]!)),
        parsed = readAttributes(preceding, 0)
      if (parsed?.end !== preceding.length) break
      attrs.unshift(preceding)
      first--
    }
    const previous = lines[first - 1] ?? ''
    const previousContent = previous.slice(contentStart(previous)).trim()
    if (
      first > 0 &&
      previousContent !== '' &&
      !definitionLines.has(first - 1) &&
      !/^(?:#{1,6}(?: |$)|:{3,}|\|)/.test(previousContent)
    )
      continue
    definitions.set(referenceKey(definition[1]!), {
      target: definition[2]!,
      attrs: attrs.join(''),
      line: n,
      first,
    })
    for (let k = first; k <= n; k++) definitionLines.add(k)
  }
  const references = lines.map((line, n) => {
    if (definitionLines.has(n)) return []
    const uses: {
      at: number
      end: number
      key: string
      label: string
      own: string
      formatted: boolean
    }[] = []
    for (let open = 0; open < line.length; open++) {
      if (line[open] !== '[' || definitionMask[n]![open] !== '[' || isDjotEscaped(line, open)) continue
      let close = open + 1,
        depth = 1
      for (; close < line.length; close++) {
        if (definitionMask[n]![close] !== line[close] || isDjotEscaped(line, close)) continue
        if (line[close] === '[') depth++
        if (line[close] === ']' && --depth === 0) break
      }
      if (line[close + 1] !== '[') continue
      let labelEnd = close + 2
      while (labelEnd < line.length && (line[labelEnd] !== ']' || isDjotEscaped(line, labelEnd))) labelEnd++
      if (labelEnd === line.length) continue
      const at = line[open - 1] === '!' && !isDjotEscaped(line, open - 1) ? open - 1 : open
      const content = line.slice(open + 1, close),
        explicit = line.slice(close + 2, labelEnd)
      const key = referenceKey(
        explicit ||
          renderPlainText(parse(djotEmphasis(content, (plain) => plain)), {
            smartTypography: false,
          }),
      )
      let end = labelEnd + 1,
        own = ''
      while (line[end] === '{') {
        const attrs = readAttributes(line, end)
        if (!attrs) break
        own += line.slice(end, attrs.end)
        end = attrs.end
      }
      uses.push({
        at,
        end,
        key,
        label: line.slice(at, close + 1),
        own,
        formatted: !explicit && /[_*`{^~]/.test(content),
      })
      open = end - 1
    }
    return uses
  })
  const inline = new Set<string>()
  for (const uses of references)
    for (const use of uses) {
      const definition = definitions.get(use.key)
      if (definition?.target && (definition.attrs || use.formatted)) inline.add(use.key)
    }
  const removed = new Set<number>()
  for (const definition of definitions.values()) for (let n = definition.first; n < definition.line; n++) removed.add(n)
  const joined = lines
    .map((line, n) => {
      let output = '',
        copied = 0
      for (const use of references[n]!) {
        const definition = definitions.get(use.key)
        if (!definition || !inline.has(use.key)) continue
        for (let k = definition.first; k <= definition.line; k++) removed.add(k)
        let attrs = mergedReferenceAttrs(definition.attrs, use.own)
        if (line.slice(contentStart(line)).startsWith('|'))
          attrs = attrs.replace(/\\*\|/g, (value) => (value.length % 2 ? '\\' + value : value))
        output += line.slice(copied, use.at) + `${use.label}(${definition.target})${attrs}`
        copied = use.end
      }
      return output + line.slice(copied)
    })
    .filter((_line, n) => !removed.has(n))
  while (removed.size && joined[0] === '') joined.shift()
  while (removed.size && joined.length > 1 && joined.at(-1) === '' && joined.at(-2) === '') joined.pop()
  return joined.join('\n')
}

function mergedReferenceAttrs(base: string, own: string): string {
  const slots = (source: string): Map<string, string[]> => {
    const result = new Map<string, string[]>()
    for (let at = 0; at < source.length;) {
      const attrs = readAttributes(source, at)
      if (!attrs) break
      for (const token of attrs.tokens) {
        if (token.append) result.set(token.key, [...(result.get(token.key) ?? []), token.source])
        else result.set(token.key, [token.source])
      }
      at = attrs.end
    }
    return result
  }
  const merged = slots(base)
  for (const [key, value] of slots(own)) merged.set(key, value)
  const values = [...merged.values()].flat().join(' ')
  return values ? `{${values}}` : ''
}
