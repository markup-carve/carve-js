import { djotImportLosses } from './djot-import-losses.js'
import { djotBlockLayout } from './djot-block-layout.js'
import { continuesParagraph } from './djot-attributes.js'
import { djotCollapsedReferenceCache } from './djot-collapsed-reference.js'
import { djotTableRows, isDjotEscaped, maskDjotCodeAndDestinations } from './djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'
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

function continuesReferenceQuote(source: string, at: number, label: string, contentStart: (line: string) => number): boolean {
  const firstLine = source.slice(source.lastIndexOf('\n', at) + 1, at)
  const depth = (firstLine.slice(0, contentStart(firstLine)).match(/>/g) ?? []).length
  if (depth === 0) return true
  return label.split('\n').slice(1).every(line => {
    const prefix = /^(?:[ \t]*>(?:[ \t]|$))*/.exec(line)![0]
    return (prefix.match(/>/g) ?? []).length >= depth ||
      !/^(?:#{1,6} |[-*+](?:[ \t]|$)|[0-9A-Za-z]+[.)] |:{3,}|`{3,}|~{3,}|\||\{|\[[^\]]+\]:)/.test(line.slice(prefix.length).replace(/^[ \t]*/, ''))
  })
}

function normalizeMultilineLabels(
  source: string,
  replace: (at: number, label: string, image: boolean) => string | undefined,
  explicit: boolean,
  mask: string,
): string {
  let open = -1, multiline = false, copied = 0, consumed = 0, output = ''
  const images: boolean[] = []
  const boundaries = source.includes('\n') && source.includes('[') ? new Set(djotInlineBoundaries(source, mask)) : new Set<number>()
  for (let at = 0; at < source.length; at++) {
    if (boundaries.has(at)) { images.length = 0; open = -1; multiline = false }
    if (source[at] === '[') {
      if (mask[at] !== ' ') images.push((images.at(-1) ?? false) || source[at - 1] === '!' && !isDjotEscaped(source, at - 1))
      open = at; multiline = false
    }
    else if (source[at] === '\n') multiline = true
    else if (source[at] === ']') {
      const image = mask[at] !== ' ' ? images.pop() ?? false : false
      if (open >= 0 && multiline && (explicit ? source[open - 1] === ']' : source[at + 1] === '[')) {
        const start = explicit ? open - 1 : source[open - 1] === '!' ? open - 1 : open
        if (start >= consumed) {
          consumed = at + 1
          const replacement = replace(start, source.slice(open + 1, at), image)
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
export function djotReferenceLayout(source: string, contentStart: (line: string) => number, caretOnly = false, accepted?: ReadonlyMap<number, { label: string; target: string; end: number }>, imageChildText = false, aliasesOnly = false): string {
  let mask = referenceMask(source)
  if (!caretOnly && !aliasesOnly) {
  source = normalizeMultilineLabels(source, (at, label, image) =>
    !image && !imageChildText && mask[at] !== ' ' && !isDjotEscaped(source, at) && !label.startsWith('^') &&
    !label.includes('`') && !/\n[ \t]*\n/.test(label) && continuesReferenceQuote(source, at, label, contentStart)
      ? foldLabelLines(label)
      : undefined, false, mask)
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
      : undefined, true, mask)
  }
  const collapsedReferenceText = djotCollapsedReferenceCache()
  const lines = source.split('\n')
  let definitionOffset = 0
  const offsets = lines.map(line => { const at = definitionOffset; definitionOffset += line.length + 1; return at })
  const attributeContinues = new Map<number, boolean>()
  for (let index = 0; index < lines.length; index++) {
    const start = contentStart(lines[index]!)
    const content = lines[index]!.slice(start)
    if (content.startsWith('{') && readAttributes(content, 0)?.end === content.length) {
      const previous = lines[index - 1] ?? ''
      const priorBody = previous.slice(contentStart(previous))
      attributeContinues.set(index, !/^:{3,}[ \t]*$/.test(priorBody) && !/[-*+.):]/.test(lines[index]!.slice(0, start)) && continuesParagraph(source, offsets[index]! + start))
    }
  }
  const quoteOpenings = new Set<number>()
  let previousQuoteDepth = 0
  for (const [index, line] of lines.entries()) {
    const depth = (line.slice(0, contentStart(line)).match(/>/g) ?? []).length
    if (depth > previousQuoteDepth) quoteOpenings.add(index)
    previousQuoteDepth = depth
  }
  const definitions = new Map<string, { target: string; attrs: string; slots: Map<string, string[]>; line: number; first: number }>()
  const definitionMask = referenceMask(source).split('\n')
  const definitionLines = new Set<number>()
  const removed = new Set<number>()
  const pipeMask = source.includes('|') ? maskDjotCodeAndDestinations(source, false, true, false, undefined, [], { destinations: false, autolinks: false, attributeValues: false, comments: false }).split('\n') : []
  const tableRows = source.includes('|') ? djotTableRows(source, pipeMask.join('\n')) : []
  for (let n = 0; n < lines.length; n++) {
    const start = contentStart(lines[n]!)
    const definition = /^\[(?!\^[^\]\n]+\]:(?:[ \t\r]|$))([^\]\n]+)\]:[ \t]*([^ \t\r\n]*)\r?$/.exec(lines[n]!.slice(start))
    if (!definition || definitionMask[n]![start] !== '[' || caretOnly && (!definition[1]!.startsWith('^') || !accepted?.has(n))) continue
    let first = n, cursor = n
    const attrs: string[] = []
    const attributeLines: number[] = []
    let attributeDepth: number | undefined
    while (cursor > 0 && !caretOnly && !aliasesOnly) {
      const precedingStart = contentStart(lines[cursor - 1]!)
      const precedingPrefix = lines[cursor - 1]!.slice(0, precedingStart)
      const prefix = lines[n]!.slice(0, start)
      const quoteDepth = (value: string) => value.split('>').length - 1
      if (/[-*+.):]/.test(prefix) || quoteDepth(prefix) > quoteDepth(precedingPrefix)) break
      const depth = quoteDepth(precedingPrefix)
      const preceding = lines[cursor - 1]!.slice(precedingStart)
      if (preceding.trim() === '') {
        if (quoteOpenings.has(cursor - 1)) break
        if (attributeDepth !== undefined && depth < attributeDepth) break
        cursor--; continue
      }
      if (attributeDepth !== undefined && depth < attributeDepth) break
      if (!/[-*+.):]/.test(precedingPrefix) && attributeContinues.get(cursor - 1) === true) break
      const parsed = readAttributes(preceding, 0)
      if (parsed?.end !== preceding.length) break
      attributeDepth = depth
      attrs.push(preceding)
      attributeLines.push(cursor - 1)
      first = --cursor
      if (quoteOpenings.has(cursor)) break
    }
    const boundary = (at: number): boolean => {
      const previous = lines[at - 1] ?? ''
      const previousStart = contentStart(previous)
      const previousContent = previous.slice(previousStart).trim()
      const currentStart = contentStart(lines[at] ?? '')
      const noteAt = previous.slice(0, previousStart).indexOf('[^')
      const ownerStart = noteAt < 0 ? previousStart : noteAt + 1
      const quoteDepth = (line: string): number => (/^(?:(?:[ \t]*>)+[ \t]*)?/.exec(line)![0].match(/>/g) ?? []).length
      const outdented = quoteDepth(lines[at] ?? '') < quoteDepth(previous) || currentStart < ownerStart && (noteAt >= 0 || /(?:[-*+] |[0-9A-Za-z]+[.)] |\([0-9A-Za-z]+\) )/.test(previous.slice(0, previousStart)))
      return at === 0 || previousContent === '' || outdented || definitionLines.has(at - 1) ||
        /^(?:#{1,6}(?: |$)|:{3,}|[`~]{3,}|\||(?:[-*][ \t]*){3,}$)/.test(previousContent) ||
        readAttributes(previousContent, 0)?.end === previousContent.length
    }
    if (!boundary(first)) {
      let tail = -1
      for (const [index, at] of attributeLines.entries()) {
        const previous = lines[at - 1] ?? ''
        if (previous.slice(contentStart(previous)).trim() === '') tail = index
      }
      if (tail >= 0) {
        first = attributeLines[tail]!
        attrs.length = tail + 1
        attributeLines.length = tail + 1
      } else {
        if (!boundary(n)) continue
        first = n
        attrs.length = 0
        attributeLines.length = 0
      }
    }
    for (const at of attributeLines) removed.add(at)
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
  const headingTargets = new Map<string, string>()
  if (aliasesOnly && source.includes('\0U\0') && source.includes('#')) {
    const targets = new Map<string, string>()
    djotImportLosses(source, djotTableRows(source, mask), contentStart, [], accepted ?? new Map(), targets)
    for (const [key, target] of targets)
      if (key.includes('\0U\0') && target.startsWith('#') && !definitions.has(key)) headingTargets.set(key, target)
  }
  if (!definitions.size && !headingTargets.size) return source
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
  const hasSourceNuls = source.includes('\0U\0')
  const scanNestedAliases = aliasesOnly && hasSourceNuls && [...definitions.keys()].some(key => key.includes('�'))
  let nativeDefinitions: ReadonlyMap<string, unknown> = definitions
  if (scanNestedAliases && source.includes('#')) {
    const targets = new Map<string, string>()
    djotImportLosses(source, djotTableRows(source, mask), contentStart, [], accepted ?? new Map(), targets)
    nativeDefinitions = targets
  }
  const referenceLabels = new Set<number>()
  const references = lines.map((): ReferenceUse[] => [])
  if (rowAt) {
    const quoteDepths = lines.map(line => (line.slice(0, contentStart(line)).match(/>/g) ?? []).length)
    if (quoteDepths.some(depth => depth > 0))
      djotBlockLayout(source, djotTableRows(source, mask), undefined, undefined, undefined, undefined, (line, depth) => { quoteDepths[line] = depth })
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
    const wrapperText = new Map<number, string>()
    const aliasLabelText = (open: number, close: number): string => {
      if (!scanNestedAliases || rowAt[open] !== rowAt[close])
        return collapsedReferenceText(referenceSource.slice(open + 1, close), quoteDepths[rowAt[open]!]!)
      const wrappers: number[] = []
      let current = open, end = close
      while (!wrapperText.has(current)) {
        wrappers.push(current)
        const child = referenceSource[current + 1] === '!' ? current + 2 : current + 1
        const childClose = closers.get(child)
        if (referenceSource[child] !== '[' || escaped[child] || childClose === undefined || referenceSource[childClose + 1] !== '[' || nextCloser[childClose + 2] !== end - 1 || referenceSource[child + 1] === '^') {
          wrapperText.set(current, collapsedReferenceText(referenceSource.slice(current + 1, end), quoteDepths[rowAt[current]!]!))
          break
        }
        current = child
        end = childClose
      }
      const value = wrapperText.get(current)!
      for (const wrapper of wrappers) wrapperText.set(wrapper, value)
      return value
    }
    let boundaryIndex = 0
    for (let open = 0; open < referenceSource.length; open++) {
      while (boundaryIndex < boundaries.length && boundaries[boundaryIndex]! <= open) boundaryIndex++
      const n = rowAt[open]!
      if (definitionLines.has(n)) continue
      if (referenceLabels.has(open)) continue
      if (referenceSource[open] !== '[' || referenceMaskText[open] !== '[' || escaped[open]) continue
      const close = closers.get(open)
      if (close === undefined || referenceSource[close + 1] !== '[') continue
      const labelEnd = nextCloser[close + 2]!
      if (labelEnd < 0 || (nextPipe && nextPipe[open]! >= 0 && nextPipe[open]! < labelEnd)) continue
      if (boundaries[boundaryIndex] !== undefined && labelEnd >= boundaries[boundaryIndex]!) continue
      const at = referenceSource[open - 1] === '!' && !escaped[open - 1] ? open - 1 : open
      const content = referenceSource.slice(open + 1, close),
        explicit = referenceSource.slice(close + 2, labelEnd)
      if (content.startsWith('^') && content.length > 1) continue
      const key = explicit ? referenceKey(explicit) : definitionKey(
        aliasLabelText(open, close),
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
        formatted: !explicit && /[_*`{^~"']/.test(content),
      })
      referenceLabels.add(close + 1)
      if (!scanNestedAliases || !nativeDefinitions.has(key) || explicit && !definitions.has(key)) open = end - 1
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
  if (caretOnly) for (const decision of accepted?.values() ?? []) occupied.add(definitionKey(decision.label))
  for (const uses of references) for (const use of uses) occupied.add(use.key)
  let serial = 0
  const nextAlias = (): string => {
    let alias: string
    do { alias = `carve-djot-reference-${++serial}` } while (occupied.has(alias))
    occupied.add(alias)
    return alias
  }
  const aliases = new Map<string, string>()
  if (source.includes('\\') || source.includes('|') || source.includes('[') || source.includes('\0')) {
    const aliasKeys = new Set([...definitions.keys()].filter(key => key.startsWith('^') || key.includes('\\') || key.includes('|') || key.includes('[') || key.includes('`') || key.includes('\0') || aliasesOnly && hasSourceNuls && key.includes('�')))
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
  if (aliasesOnly) {
    const edits: Array<[number, number, string]> = []
    for (const n of definitionLines) {
      const start = contentStart(lines[n]!)
      const definition = /^\[([^\]\n]+)\]:/.exec(lines[n]!.slice(start))!
      const alias = aliases.get(definitionKey(definition[1]!))
      if (alias) edits.push([offsets[n]! + start + 1, offsets[n]! + start + 1 + definition[1]!.length, alias])
    }
    for (const uses of references) for (const use of uses) {
      const headingTarget = headingTargets.get(use.key)
      if (headingTarget !== undefined) {
        const target = headingTarget.replace(/[\\()]/g, char => '\\' + char)
        edits.push([use.at, use.end, use.label + '(' + target + ')' + use.own])
      } else {
        const alias = aliases.get(use.key)
        if (alias) edits.push([use.at + use.label.length + 1, use.end - use.own.length - 1, alias])
      }
    }
    edits.sort((a, b) => a[0] - b[0])
    const parts: string[] = []
    let cursor = 0
    for (const [start, end, value] of edits) { parts.push(source.slice(cursor, start), value); cursor = end }
    return parts.join('') + source.slice(cursor)
  }
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
    const definition = /^\[([^\]\n]+)\]:/.exec(line.slice(start))
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
      const first = definitions.get(key)!.first
      const before = lines[first - 1] ?? ''
      const separate = prefix === '' && attrs !== '' && before.slice(contentStart(before)).trim() !== '' && !definitionLines.has(first - 1)
      renamedLines.set(n, (separate ? '\n' : '') + prefix + target)
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
      if (caretOnly) {
        edits.push({ at: use.at, end: use.end, text: `${use.label}[${name}]${use.own}` })
        continue
      }
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
