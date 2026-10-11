import { djotEmphasis } from './djot-emphasis.js'
import { djotTableRows, isDjotEscaped, maskDjotCodeAndDestinations } from './djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'
import { parseRefLabelInlines } from './parse.js'
import { djotReferenceText } from './djot-reference-label.js'
import { parseAttrs } from './attribute-parser.js'
import { djotInlineBoundaries } from './djot-inline-boundaries.js'

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

/** Normalize reference labels and share definition attributes. */
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
      const definition = /^\[(?!\^)([^\]\n]+)\]:/.exec(line.slice(contentStart(line)))
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
  const removed = new Set<number>()
  const pipeMask = source.includes('|') ? maskDjotCodeAndDestinations(source, false, true, false, undefined, [], { destinations: false, autolinks: false, attributeValues: false, comments: false }).split('\n') : []
  const tableRows = source.includes('|') ? djotTableRows(source, pipeMask.join('\n')) : []
  for (let n = 0; n < lines.length; n++) {
    const start = contentStart(lines[n]!)
    const definition = /^\[(?!\^)([^\]\n]+)\]:[ \t]*(\S*)[ \t]*$/.exec(lines[n]!.slice(start))
    if (!definition || definitionMask[n]![start] !== '[') continue
    let first = n
    const attrs: string[] = []
    while (first > 0) {
      const precedingStart = contentStart(lines[first - 1]!)
      const precedingPrefix = lines[first - 1]!.slice(0, precedingStart)
      const prefix = lines[n]!.slice(0, start)
      const quoteDepth = (value: string) => value.split('>').length - 1
      if (/[-*+.):]/.test(prefix) || quoteDepth(prefix) > quoteDepth(precedingPrefix)) break
      const preceding = lines[first - 1]!.slice(precedingStart),
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
      !/^(?:#{1,6}(?: |$)|:{3,}|\|)/.test(previousContent) &&
      readAttributes(previousContent, 0)?.end !== previousContent.length
    )
      continue
    for (let k = first; k < n; k++) removed.add(k)
    const attributes = attrs.reverse().join('')
    definitions.set(definitionKey(definition[1]!), {
      target: definition[2]!,
      attrs: attributes,
      slots: referenceAttributeSlots(attributes),
      line: n,
      first,
    })
    for (let k = first; k <= n; k++) definitionLines.add(k)
  }
  if (!definitions.size) return source
  const lineOffsets: number[] = []
  const hasReferencePairs = source.includes('][')
  const rowAt = hasReferencePairs ? new Uint32Array(source.length + 1) : undefined
  let offset = 0
  for (const [n, line] of lines.entries()) {
    lineOffsets.push(offset)
    rowAt?.fill(n, offset, offset + line.length + 1)
    offset += line.length + 1
  }
  type ReferenceUse = {
    at: number; end: number; key: string; rawKey: string; label: string
    own: string; ownSlots: Map<string, string[]>; formatted: boolean
  }
  const references = lines.map((): ReferenceUse[] => [])
  if (rowAt) {
    const referenceSource = source, referenceMaskText = definitionMask.join('\n'), pipeMaskText = pipeMask.join('\n')
    const boundaries = djotInlineBoundaries(source, referenceMaskText)
    const boundarySet = new Set(boundaries)
    const escaped = new Uint8Array(referenceSource.length)
    const closers = new Map<number, number>()
    const brackets: number[] = []
    let slashes = 0
    for (let at = 0; at < referenceSource.length; at++) {
      if (boundarySet.has(at)) brackets.length = 0
      escaped[at] = slashes % 2
      slashes = referenceSource[at] === '\\' ? slashes + 1 : 0
      if (tableRows[rowAt[at]!] && referenceSource[at] === '|' && pipeMaskText[at] === '|' && !escaped[at]) brackets.length = 0
      if (referenceMaskText[at] !== referenceSource[at] || escaped[at]) continue
      if (referenceSource[at] === '[') brackets.push(at)
      else if (referenceSource[at] === ']') {
        const open = brackets.pop()
        if (open !== undefined) closers.set(open, at)
      }
    }
    const nextCloser = new Int32Array(referenceSource.length + 1).fill(-1)
    const nextPipe = source.includes('|') ? new Int32Array(referenceSource.length + 1).fill(-1) : undefined
    let pipe = -1, next = -1
    for (let at = referenceSource.length - 1; at >= 0; at--) {
      if (referenceSource[at] === '[' && referenceMaskText[at] === '[' && !escaped[at]) next = -1
      else if (referenceSource[at] === ']' && !escaped[at]) next = at
      nextCloser[at] = next
      if (nextPipe) {
        if (tableRows[rowAt[at]!] && referenceSource[at] === '|' && pipeMaskText[at] === '|' && !escaped[at]) pipe = at
        nextPipe[at] = pipe
      }
    }
    let boundaryIndex = 0
    for (let open = 0; open < referenceSource.length; open++) {
      while (boundaryIndex < boundaries.length && boundaries[boundaryIndex]! <= open) boundaryIndex++
      const n = rowAt[open]!
      if (definitionLines.has(n)) continue
      if (referenceSource[open] !== '[' || referenceMaskText[open] !== '[' || escaped[open]) continue
      const close = closers.get(open)
      if (close === undefined || referenceSource[close + 1] !== '[') continue
      const labelEnd = nextCloser[close + 2]!
      if (labelEnd < 0 || (nextPipe && nextPipe[open]! >= 0 && nextPipe[open]! < labelEnd)) continue
      if (boundaries[boundaryIndex] !== undefined && labelEnd >= boundaries[boundaryIndex]!) continue
      const at = referenceSource[open - 1] === '!' && !escaped[open - 1] ? open - 1 : open
      const content = referenceSource.slice(open + 1, close),
        explicit = referenceSource.slice(close + 2, labelEnd)
      const key = explicit ? referenceKey(explicit) : definitionKey(
        djotReferenceText(parseRefLabelInlines(djotEmphasis(content, (plain) => plain))),
      )
      let end = labelEnd + 1,
        own = ''
      while (referenceSource[end] === '{') {
        const attrs = readAttributes(referenceSource, end)
        if (!attrs) break
        own += referenceSource.slice(end, attrs.end)
        end = attrs.end
      }
      references[n]!.push({
        at,
        end,
        key,
        rawKey: (explicit || content).includes('\\') ? definitionKey(explicit || content) : key,
        label: referenceSource.slice(at, close + 1),
        own,
        ownSlots: referenceAttributeSlots(own),
        formatted: !explicit && /[_*`{^~]/.test(content),
      })
      open = end - 1
    }
  }
  const useCounts = new Map<string, number>()
  const overrideCounts = new Map<string, Map<string, number>>()
  for (const uses of references) for (const use of uses) {
    if (!definitions.get(use.key)?.target) continue
    useCounts.set(use.key, (useCounts.get(use.key) ?? 0) + 1)
    let counts = overrideCounts.get(use.key)
    if (!counts) overrideCounts.set(use.key, counts = new Map())
    for (const key of use.ownSlots.keys()) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const [key, definition] of definitions) {
    for (const [attribute, count] of overrideCounts.get(key) ?? [])
      if (count === useCounts.get(key)) definition.slots.delete(attribute)
  }
  const occupied = new Set(definitions.keys())
  for (const uses of references) for (const use of uses) occupied.add(use.key)
  let serial = 0
  const nextAlias = (): string => {
    let alias: string
    do { alias = `carve-djot-reference-${++serial}` } while (occupied.has(alias))
    occupied.add(alias)
    return alias
  }
  const aliases = new Map<string, string>()
  if (source.includes('\\') || source.includes('|') || source.includes('[')) {
    const aliasKeys = new Set([...definitions.keys()].filter(key => key.includes('\\') || key.includes('|') || key.includes('[')))
    for (const uses of references) for (const use of uses)
      if (use.rawKey !== use.key && definitions.has(use.key)) aliasKeys.add(use.key)
    if (aliasKeys.size) {
      for (const key of definitions.keys()) {
        if (!aliasKeys.has(key)) continue
        aliases.set(key, nextAlias())
      }
    }
  }
  const renamedLines = new Map<number, string>()
  const movedDefinitions: string[] = []
  const liftedAttributes = new Set<string>()
  for (const [key, definition] of definitions) {
    const line = lines[definition.line]!, start = contentStart(line)
    if (!definition.target || !definition.slots.size || !start || /^\s*$/.test(line.slice(0, start))) continue
    const alias = aliases.get(key) ?? nextAlias()
    aliases.set(key, alias)
    liftedAttributes.add(key)
    movedDefinitions.push(`[${alias}]: ${definition.target} ${mergedReferenceAttrs(definition.slots, '')}`)
  }
  const classAliases = new Map<string, string>()
  for (const [key, definition] of definitions) {
    if (!definition.target || !definition.slots.has('class') || !overrideCounts.get(key)?.has('class')) continue
    const alias = nextAlias()
    classAliases.set(key, alias)
    const slots = new Map(definition.slots)
    slots.delete('class')
    const attrs = mergedReferenceAttrs(slots, '')
    movedDefinitions.push(`[${alias}]: ${definition.target}${attrs ? ' ' + attrs : ''}`)
  }
  for (const n of definitionLines) {
    const line = lines[n]!, start = contentStart(line)
    const definition = /^\[(?!\^)([^\]\n]+)\]:/.exec(line.slice(start))
    if (!definition) continue
    const key = definitionKey(definition[1]!), alias = aliases.get(key)
    const close = line.indexOf(']:', start), prefix = line.slice(0, start)
    if (definitions.get(key)!.line !== n) {
      renamedLines.set(n, prefix + '{%%}')
      continue
    }
    if (liftedAttributes.has(key)) continue
    const attrs = definitions.get(key)!.target ? mergedReferenceAttrs(definitions.get(key)!.slots, '') : ''
    const target = '[' + (alias ?? definition[1]!) + line.slice(close) + (attrs ? ' ' + attrs : '')
    if (start > 0 && /^\s*$/.test(prefix)) {
      renamedLines.set(n, prefix + '{%%}')
      movedDefinitions.push(target)
    } else if (alias || attrs) {
      renamedLines.set(n, prefix + target)
    }
  }
  const edits: { at: number; end: number; text: string }[] = []
  for (const [n, line] of lines.entries()) {
    const start = contentStart(line), at = lineOffsets[n]!
    if (removed.has(n)) {
      edits.push({ at, end: at + line.length + (start === 0 && n + 1 < lines.length ? 1 : 0), text: start > 0 ? line.slice(0, start) + '{%%}' : '' })
      continue
    }
    if (renamedLines.has(n)) edits.push({ at, end: at + line.length, text: renamedLines.get(n)! })
    const table = line.slice(start).startsWith('|')
    for (const use of references[n]!) {
      const definition = definitions.get(use.key)
      if (!definition) continue
      const name = (use.ownSlots.has('class') ? classAliases.get(use.key) : undefined)
        ?? aliases.get(use.key) ?? use.key
      if (!definition.attrs) {
        if (aliases.has(use.key) || use.formatted || definition.target && use.own) {
          let attrs = definition.target ? mergedReferenceAttrs(use.ownSlots, '') : use.own
          if (table) attrs = attrs.replace(/\\*\|/g, (value) => (value.length % 2 ? '\\' + value : value))
          edits.push({ at: use.at, end: use.end, text: `${use.label}[${name}]${attrs}` })
        }
        continue
      }
      let attrs = definition.target
        ? mergedReferenceAttrs(use.ownSlots, '')
        : mergedReferenceAttrs(definition.slots, use.own)
      if (table)
        attrs = attrs.replace(/\\*\|/g, (value) => (value.length % 2 ? '\\' + value : value))
      edits.push({ at: use.at, end: use.end, text: `${use.label}[${name}]${attrs}` })
    }
  }
  let body = '', copied = 0
  for (const edit of edits) {
    if (edit.at < copied) continue
    body += source.slice(copied, edit.at) + edit.text
    copied = edit.end
  }
  body += source.slice(copied)
  if (removed.size) {
    let start = 0, end = body.length
    while (body[start] === '\n') start++
    while (end > start && body[end - 1] === '\n') end--
    body = body.slice(start, end) + (end < body.length ? '\n' : '')
  }
  return movedDefinitions.length ? movedDefinitions.join('\n') + '\n\n' + body : body
}

function referenceAttributeSlots(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (let at = 0; at < source.length;) {
    const attrs = readAttributes(source, at)
    if (!attrs) break
    const group = new Map<string, string[]>()
    for (const token of attrs.tokens) {
      if (token.append) {
        const values = group.get(token.key)
        if (values) {
          if (token.key === 'class' && values.length === 1 && values[0] === 'class=""') values.length = 0
          values.push(token.source)
        } else group.set(token.key, [token.source])
      } else group.set(token.key, [token.source])
    }
    for (const [key, values] of group) {
      const previous = result.get(key)
      if (key === 'class' && previous && !(previous.length === 1 && previous[0] === 'class=""')) {
        for (const value of values) previous.push(value)
      } else result.set(key, values)
    }
    at = attrs.end
  }
  return result
}

function mergedReferenceAttrs(base: ReadonlyMap<string, string[]>, own: string): string {
  const merged = new Map(base)
  for (const [key, value] of referenceAttributeSlots(own)) merged.set(key, value)
  const values = [...merged].flatMap(([key, tokens]) => {
    if (key !== 'class') return tokens
    const classes = (parseAttrs(tokens.join(' ')).classes ?? []).join(' ')
    return [`class="${classes.replace(/[\\"]/g, char => '\\' + char)}"`]
  }).join(' ')
  return values ? `{${values}}` : ''
}
