import { djotEmphasis } from './djot-emphasis.js'
import { djotTableRows, isDjotEscaped, maskDjotCodeAndDestinations } from './djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'
import { parseRefLabelInlines } from './parse.js'
import { inlineText } from './heading-ids.js'

const definitionKey = (label: string): string => label.trim().replace(/[ \t\r\n]+/g, ' ')
const referenceKey = (label: string): string =>
  definitionKey(label.replace(/\\([ \t!-\/:-@\[-`{-~])/g, '$1'))

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

function foldLabelLines(label: string): string {
  const lines = label.split('\n')
  const first = lines.shift()!.trimEnd()
  const last = lines.pop()!.trimStart()
  return [first, ...lines.map(line => line.trim()).filter(Boolean), last].join(' ')
}

function normalizeMultilineLabels(
  source: string,
  replace: (at: number, label: string) => string | undefined,
  explicit: boolean,
): string {
  let open = -1, multiline = false, copied = 0, consumed = 0, output = ''
  for (let at = 0; at < source.length; at++) {
    if (source[at] === '[') { open = at; multiline = false }
    else if (source[at] === '\n') multiline = true
    else if (source[at] === ']') {
      if (open >= 0 && multiline && (explicit ? source[open - 1] === ']' : source[at + 1] === '[')) {
        const start = explicit ? open - 1 : source[open - 1] === '!' ? open - 1 : open
        if (start >= consumed) {
          consumed = at + 1
          const replacement = replace(start, source.slice(open + 1, at))
          if (replacement !== undefined) {
            output += source.slice(copied, start) + source.slice(start, open + 1) + replacement + ']'
            copied = at + 1
          }
        }
      }
      open = -1
    }
  }
  return output + source.slice(copied)
}

/** Normalize reference labels and carry definition attributes to each use. */
export function djotReferenceLayout(source: string, contentStart: (line: string) => number): string {
  let mask = referenceMask(source)
  source = normalizeMultilineLabels(source, (at, label) =>
    mask[at] !== ' ' && !isDjotEscaped(source, at) && !label.startsWith('^') &&
    !label.includes('`') && !/\n[ \t]*\n/.test(label)
      ? foldLabelLines(label)
      : undefined, false)
  mask = referenceMask(source)
  const labels = new Set(
    source.split('\n').flatMap((line) => {
      const definition = /^\[(?!\^)([^\[\]\n]+)\]:/.exec(line.slice(contentStart(line)))
      return definition ? [definitionKey(definition[1]!)] : []
    }),
  )
  source = normalizeMultilineLabels(source, (at, label) =>
    mask[at] === ']' && !/\n[ \t]*\n/.test(label) && labels.has(referenceKey(label))
      ? label.replace(/\s+/g, ' ').trim()
      : undefined, true)
  const lines = source.split('\n')
  const definitions = new Map<string, { target: string; attrs: string; slots: Map<string, string[]>; line: number; first: number }>()
  const definitionMask = referenceMask(source).split('\n')
  const definitionLines = new Set<number>()
  const indentedDefinitionLines = new Set<number>()
  const tableRows = source.includes('|') ? djotTableRows(source, definitionMask.join('\n')) : []
  for (let n = 0; n < lines.length; n++) {
    const start = contentStart(lines[n]!)
    const definition = /^\[(?!\^)([^\[\]\n]+)\]:[ \t]*(\S*)[ \t]*$/.exec(lines[n]!.slice(start))
    if (!definition || definitionMask[n]![start] !== '[') continue
    let first = n
    const attrs: string[] = []
    while (first > 0) {
      const preceding = lines[first - 1]!.slice(contentStart(lines[first - 1]!)),
        parsed = readAttributes(preceding, 0)
      if (parsed?.end !== preceding.length) break
      attrs.push(preceding)
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
    const attributes = attrs.reverse().join('')
    definitions.set(definitionKey(definition[1]!), {
      target: definition[2]!,
      attrs: attributes,
      slots: referenceAttributeSlots(attributes),
      line: n,
      first,
    })
    for (let k = first; k <= n; k++) definitionLines.add(k)
    if (start > 0 && /^\s*$/.test(lines[n]!.slice(0, start))) indentedDefinitionLines.add(n)
  }
  const references = lines.map((line, n) => {
    if (definitionLines.has(n) || !line.includes('][')) return []
    const uses: {
      at: number
      end: number
      key: string
      rawKey: string
      label: string
      own: string
      formatted: boolean
    }[] = []
    const escaped = new Uint8Array(line.length)
    const closers = new Map<number, number>()
    const brackets: number[] = []
    let slashes = 0
    for (let at = 0; at < line.length; at++) {
      escaped[at] = slashes % 2
      slashes = line[at] === '\\' ? slashes + 1 : 0
      if (tableRows[n] && line[at] === '|' && !escaped[at]) brackets.length = 0
      if (definitionMask[n]![at] !== line[at] || escaped[at]) continue
      if (line[at] === '[') brackets.push(at)
      else if (line[at] === ']') {
        const open = brackets.pop()
        if (open !== undefined) closers.set(open, at)
      }
    }
    const nextCloser = new Int32Array(line.length + 1).fill(-1)
    const nextPipe = tableRows[n] ? new Int32Array(line.length + 1).fill(-1) : undefined
    let pipe = -1, next = -1
    for (let at = line.length - 1; at >= 0; at--) {
      if (line[at] === ']' && !escaped[at]) next = at
      nextCloser[at] = next
      if (nextPipe) {
        if (line[at] === '|' && !escaped[at]) pipe = at
        nextPipe[at] = pipe
      }
    }
    for (let open = 0; open < line.length; open++) {
      if (line[open] !== '[' || definitionMask[n]![open] !== '[' || escaped[open]) continue
      const close = closers.get(open)
      if (close === undefined || line[close + 1] !== '[') continue
      const labelEnd = nextCloser[close + 2]!
      if (labelEnd < 0 || (nextPipe && nextPipe[open]! >= 0 && nextPipe[open]! < labelEnd)) continue
      const at = line[open - 1] === '!' && !escaped[open - 1] ? open - 1 : open
      const content = line.slice(open + 1, close),
        explicit = line.slice(close + 2, labelEnd)
      const key = explicit ? referenceKey(explicit) : definitionKey(
        inlineText(parseRefLabelInlines(djotEmphasis(content, (plain) => plain)), false),
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
        rawKey: (explicit || content).includes('\\') ? definitionKey(explicit || content) : key,
        label: line.slice(at, close + 1),
        own,
        formatted: !explicit && /[_*`{^~]/.test(content),
      })
      open = end - 1
    }
    return uses
  })
  const aliases = new Map<string, string>()
  if (source.includes('\\') || source.includes('|')) {
    const aliasKeys = new Set([...definitions.keys()].filter(key => key.includes('\\') || key.includes('|')))
    for (const uses of references) for (const use of uses)
      if (use.rawKey !== use.key && definitions.has(use.key)) aliasKeys.add(use.key)
    if (aliasKeys.size) {
      const occupied = new Set(definitions.keys())
      for (const uses of references) for (const use of uses) occupied.add(use.key)
      let serial = 0
      for (const key of definitions.keys()) {
        if (!aliasKeys.has(key)) continue
        let alias: string
        do { alias = `carve-djot-reference-${++serial}` } while (occupied.has(alias))
        occupied.add(alias)
        aliases.set(key, alias)
      }
    }
  }
  const renamedLines = new Map<number, string>()
  const movedDefinitions: string[] = []
  for (const n of aliases.size ? definitionLines : indentedDefinitionLines) {
    const line = lines[n]!, start = contentStart(line)
    const definition = /^\[(?!\^)([^\[\]\n]+)\]:/.exec(line.slice(start))
    if (!definition) continue
    const key = definitionKey(definition[1]!), alias = aliases.get(key)
    const close = line.indexOf(']:', start), prefix = line.slice(0, start)
    if (start > 0 && /^\s*$/.test(prefix)) {
      renamedLines.set(n, prefix + '{%%}')
      movedDefinitions.push('[' + (alias ?? definition[1]!) + line.slice(close))
    } else if (alias) {
      renamedLines.set(n, prefix + '[' + alias + line.slice(close))
    }
  }
  const removed = new Set<number>()
  for (const definition of definitions.values()) for (let n = definition.first; n < definition.line; n++) removed.add(n)
  const joined = lines
    .map((line, n) => {
      const start = contentStart(line)
      if (removed.has(n) && start > 0) return line.slice(0, start) + '{%%}'
      if (renamedLines.has(n)) return renamedLines.get(n)!
      let output = '',
        copied = 0
      const table = line.slice(contentStart(line)).startsWith('|')
      for (const use of references[n]!) {
        const definition = definitions.get(use.key)
        if (!definition) continue
        const name = aliases.get(use.key) ?? use.key
        if (!definition.attrs) {
          if (aliases.has(use.key) || use.formatted) {
            output += line.slice(copied, use.at) + `${use.label}[${name}]${use.own}`
            copied = use.end
          }
          continue
        }
        let attrs = mergedReferenceAttrs(definition.slots, use.own)
        if (table)
          attrs = attrs.replace(/\\*\|/g, (value) => (value.length % 2 ? '\\' + value : value))
        output += line.slice(copied, use.at) + `${use.label}[${name}]${attrs}`
        copied = use.end
      }
      return output + line.slice(copied)
    })
    .filter((_line, n) => !removed.has(n) || contentStart(lines[n]!) > 0)
  let first = 0, last = joined.length
  while (removed.size && joined[first] === '') first++
  while (removed.size && last - first > 1 && joined[last - 1] === '' && joined[last - 2] === '') last--
  const body = joined.slice(first, last).join('\n')
  return movedDefinitions.length ? movedDefinitions.join('\n') + '\n\n' + body : body
}

function referenceAttributeSlots(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (let at = 0; at < source.length;) {
    const attrs = readAttributes(source, at)
    if (!attrs) break
    for (const token of attrs.tokens) {
      if (token.append) {
        const values = result.get(token.key)
        if (values) values.push(token.source)
        else result.set(token.key, [token.source])
      } else result.set(token.key, [token.source])
    }
    at = attrs.end
  }
  return result
}

function mergedReferenceAttrs(base: ReadonlyMap<string, string[]>, own: string): string {
  const merged = new Map(base)
  for (const [key, value] of referenceAttributeSlots(own)) merged.set(key, value)
  const values = [...merged.values()].flat().join(' ')
  return values ? `{${values}}` : ''
}
