import { djotStructuralPrefixEnd } from './djot-structural-prefix.js'
import { isDjotEscaped, maskDjotCodeAndDestinations } from './djot-migrate.js'
import { nativeAttributeReader } from './djot-attributes.js'

type Pair = {
  start: number
  openEnd: number
  close: number
  end: number
  kind: string
  forced: boolean
  children: Pair[]
  kinds: Set<string>
}
type Opener = { start: number; end: number; kind: string; forced: boolean }

export { djotStructuralPrefixSteps, djotStructuralPrefixEnd } from './djot-structural-prefix.js'

export function djotEmphasis(source: string, convert: (plain: string) => string, flattened?: (offset: number) => void): string {
  return processDjotEmphasis(source, convert, undefined, flattened)
}

export function djotPairedEmphasisOpeners(source: string): Map<number, number> {
  const paired = new Map<number, number>()
  processDjotEmphasis(source, plain => plain, paired)
  return paired
}

function processDjotEmphasis(source: string, convert: (plain: string) => string, paired?: Map<number, number>, flattened?: (offset: number) => void): string {
  const mask = maskFootnotes(maskDjotEmphasisSource(source)).replace(/<[^<>\s]+>/g, value => /[^:]@|[A-Za-z]:/.test(value) ? ' '.repeat(value.length) : value).replace(/(?<=\])\[[^\]\n]*\]/gm, value => ' '.repeat(value.length)).split('')
  const readAttributes = nativeAttributeReader(source)
  const attributes = new Map<number, { end: number; source: string }>()
  const emptyBlockAttributes = new Set<number>()
  const listBoundaryComments = new Map<number, string>()
  let attributeLineStart = 0, attributeLineEnd = -1, previousAttributeLine = ''
  let attributePrefixEnd = 0, listAttribute = false
  let previousContent = '', previousItemWidth = 0, attributeIndent = 0
  let activeAttributeListColumn: number | undefined
  for (let i = 0; i < source.length; i++) {
    if (mask[i] !== '{') continue
    while (attributeLineEnd < i) {
      if (attributeLineEnd >= 0) {
        previousAttributeLine = source.slice(attributeLineStart, attributeLineEnd)
        attributeLineStart = attributeLineEnd + 1
      }
      const newline = source.indexOf('\n', attributeLineStart)
      attributeLineEnd = newline < 0 ? source.length : newline
      const line = source.slice(attributeLineStart, attributeLineEnd)
      const prefix = /^[ \t>]*(?:(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+)?/.exec(line)![0]
      attributePrefixEnd = attributeLineStart + prefix.length
      listAttribute = /[-*+.)]/.test(prefix)
      previousContent = previousAttributeLine.replace(/^(?:[ \t]*>[ \t]?)*/, '')
      previousItemWidth = /^[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdm]+|[IVXLCDM]+)\))[ \t]+/.exec(previousContent)?.[0].length ?? 0
      attributeIndent = prefix.replace(/^(?:[ \t]*>[ \t]?)*/, '').length
      listAttribute = listAttribute && (attributeLineStart === 0 || previousContent.trim() === '' || activeAttributeListColumn !== undefined)
      if (activeAttributeListColumn !== undefined && line.trim() !== '' && attributeIndent < activeAttributeListColumn && !listAttribute) {
        previousItemWidth = activeAttributeListColumn
        activeAttributeListColumn = undefined
      }
      if (listAttribute) activeAttributeListColumn = attributeIndent
    }
    let attrs = readAttributes(i)
    if (!attrs) continue
    const firstAttributeEnd = attrs.end
    while (source[attrs.end] === '{') {
      const next = readAttributes(attrs.end)
      if (!next) break
      attrs = { tokens: [...attrs.tokens, ...next.tokens], end: next.end, source: (attrs.source === '{}' ? '' : attrs.source) + (next.source === '{}' ? '' : next.source) || '{}' }
    }
    if (i === attributePrefixEnd && attrs.end !== firstAttributeEnd) attrs = { ...attrs, source: '{%%}' }
    attributes.set(i, attrs)
    if (attrs.source === '{}' && attrs.end === firstAttributeEnd && i === attributePrefixEnd &&
        /^[ \t]*$/.test(source.slice(attrs.end, attributeLineEnd)) &&
        (listAttribute || attributeLineStart === 0 || previousContent.trim() === '' || /^\{.*\}$/.test(previousContent.trim()) || attributeIndent < previousItemWidth)) {
      emptyBlockAttributes.add(i)
      if (attributeIndent < previousItemWidth) listBoundaryComments.set(i, '%%%\n' + source.slice(attributeLineStart, attributePrefixEnd) + '%%%')
    }
    for (let at = i; at < attrs.end; at++) if (mask[at] !== '\n') mask[at] = ' '
    i = attrs.end - 1
  }
  const validBraceClosers = new Set<number>()
  const validBraces = new Set<number>(), pendingBraces = new Map<string, number[]>()
  let braceLineStart = 0, lastEscaped = -1
  const literalDashes = new Set<number>()
  const keepDashes = (start: number, end: number): void => {
    for (let at = start; at + 1 < end; at++) {
      if (source.startsWith('--', at) && mask[at] === '-' && mask[at + 1] === '-') {
        literalDashes.add(at)
        literalDashes.add(at + 1)
      }
    }
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      if (
        source
          .slice(braceLineStart, i)
          .replace(/^(?:[ \t]*>)*[ \t]*/, '')
          .trim() === ''
      )
        pendingBraces.clear()
      braceLineStart = i + 1
    }
    if (mask[i] !== source[i]) continue
    if (source[i] === '\\' && source[i + 1] !== '\n') { lastEscaped = i + 1; i++; continue }
    if (source[i] === '{' && '+-=^~_*'.includes(source[i + 1] ?? '\0')) {
      const kind = source[i + 1]!, stack = pendingBraces.get(kind) ?? []
      stack.push(i); pendingBraces.set(kind, stack)
    } else if (source[i] === '}' && i - 1 !== lastEscaped && '+-=^~_*'.includes(source[i - 1] ?? '\0')) {
      const start = pendingBraces.get(source[i - 1]!)?.pop()
      if (start !== undefined && i > start + 2) {
        validBraces.add(start); validBraceClosers.add(i - 1)
        if (paired) paired.set(start + 1, i + 1)
        for (const stack of pendingBraces.values()) while (stack.at(-1) !== undefined && stack.at(-1)! > start) stack.pop()
      }
      else if (source[i - 1] === '-') {
        let first = i - 1
        while (source[first - 1] === '-') first--
        if (i - first === 2) keepDashes(first, i)
        else if (i - first > 2) literalDashes.add(i - 1)
      }
    }
  }
  const openers = new Map<string, Opener[]>(['_', '*', '~', '^', '{_', '{*', '{~', '{^'].map(key => [key, []]))
  const pairs: Pair[] = []
  const structural = new Set<number>()
  const brackets: number[] = []
  const braces: number[] = []
  const bracketPairs: Array<[number, number]> = []
  let lineStart = 0, lineEnd = source.length, structuralEnd = 0, thematicLine = false
  let previousBlank = true, container = false
  let listColumn: number | undefined
  const clear = (from: number): void => {
    for (const stack of openers.values()) while (stack.at(-1) && stack.at(-1)!.start >= from) stack.pop()
  }
  for (let i = 0; i < source.length; i++) {
    if (i === lineStart) {
      const end = source.indexOf('\n', i)
      lineEnd = end < 0 ? source.length : end
      const rawLine = source.slice(i, lineEnd)
      structuralEnd = i + djotStructuralPrefixEnd(rawLine)
      thematicLine = /^(?:[ \t]*>)*[ \t]*(?:\*[ \t]*){3,}$/.test(rawLine)
      const line = rawLine.replace(/^(?:[ \t]*>[ ]?)*/, '')
      const indent = /^[ \t]*/.exec(line)![0].length
      if (line.trim() && listColumn !== undefined && indent < listColumn && !/^[ \t]*(?:[-*+] |[0-9]+[.)] )/.test(line))
        listColumn = undefined
      const marker = /^[ \t]*(?:[-*+][ \t]|[0-9]+[.)][ \t]|\|)/.test(line)
      if (marker && (previousBlank || container)) { clear(0); container = true }
      else if (previousBlank) container = listColumn !== undefined && indent >= listColumn
      if (marker && container) { const item = /^[ \t]*(?:[-*+]|[0-9]+[.)])[ \t]+/.exec(line); if (item) listColumn = item[0].length }
      if (/^[ \t]*(?:`{3,}|~{3,})/.test(line) || (previousBlank || container) && /^[ \t]*(?::{3,})/.test(line) || /^[ \t]*#{1,6}[ \t]/.test(line)) clear(0)
      previousBlank = line.trim() === '' || /^[ \t]*(?:`{3,}|~{3,}|:{3,}|\{[ \t.#A-Za-z}%])/.test(line)
    }
    const ch = source[i]!
    if (ch === '\n') {
      if (
        source
          .slice(lineStart, i)
          .replace(/^(?:[ \t]*>)*[ \t]*/, '')
          .trim() === ''
      ) {
        clear(0)
        brackets.length = 0
        braces.length = 0
      }
      lineStart = i + 1
      continue
    }
    if (ch === '\\' && source[i + 1] !== '\n') {
      i++
      continue
    }
    if (mask[i] !== ch) continue
    if (ch === '{' && validBraces.has(i) && !'_*'.includes(source[i + 1] ?? '\0')) { braces.push(i); continue }
    if (ch === '}' && !isDjotEscaped(source, i - 1) && braces.at(-1) !== undefined && source[i - 1] === source[braces.at(-1)! + 1]) { clear(braces.pop()!); continue }
    if (ch === '[') { brackets.push(i); continue }
    if (ch === ']') {
      const start = brackets.pop()
      if (start !== undefined) {
        clear(start)
        bracketPairs.push([start, i])
      }
      continue
    }
    if (ch !== '_' && ch !== '*' && !(paired && (ch === '~' || ch === '^'))) continue
    if (ch === '*' && i <= structuralEnd) {
      if (thematicLine) {
        for (let at = i; at < lineEnd; at++) if (source[at] === '*') structural.add(at)
        i = lineEnd - 1
        continue
      }
      if (/[ \t]/.test(source[i + 1] ?? '')) {
        structural.add(i)
        continue
      }
    }
    const forcedOpen = source[i - 1] === '{' && mask[i - 1] === '{' && !isDjotEscaped(source, i - 1)
    const forcedClose = source[i + 1] === '}'
    const canOpen = forcedOpen || (!forcedClose && source[i + 1] !== undefined && !/[ \t\r\n]/.test(source[i + 1]!))
    const canClose = !forcedOpen && (forcedClose || (i > 0 && !/[ \t\r\n]/.test(source[i - 1]!)))
    const stack = openers.get((forcedClose ? '{' : '') + ch)!
    const opener = stack.at(-1)
    if (canClose && opener && opener.end < i && (opener.start > (braces.at(-1) ?? -1) || (opener.forced && opener.start === braces.at(-1)))) {
      clear(opener.start)
      pairs.push({
        start: opener.start,
        openEnd: opener.end,
        close: i,
        end: i + (forcedClose ? 2 : 1),
        kind: ch,
        forced: opener.forced,
        children: [],
        kinds: new Set([ch]),
      })
      if (forcedClose) { if (braces.at(-1) === opener.start) braces.pop(); i++ }
    } else if (canOpen) {
      openers
        .get((forcedOpen ? '{' : '') + ch)!
        .push({ start: i - (forcedOpen ? 1 : 0), end: i + 1, kind: ch, forced: forcedOpen })
    } else if (forcedClose) i++
  }
  if (paired) {
    for (const pair of pairs) paired.set(pair.openEnd - 1, pair.end)
    return source
  }
  pairs.sort((a, b) => a.start - b.start || b.end - a.end)
  const roots: Pair[] = []
  const stack: Pair[] = []
  for (const pair of pairs) {
    while (stack.at(-1) && pair.start >= stack.at(-1)!.end) stack.pop()
    const children = stack.at(-1)?.children ?? roots
    children.push(pair)
    stack.push(pair)
  }
  for (let i = pairs.length - 1; i >= 0; i--)
    for (const child of pairs[i]!.children) for (const kind of child.kinds) pairs[i]!.kinds.add(kind)
  const starts = new Map(pairs.map((pair) => [pair.start, pair]))
  const ends = new Map(pairs.map((pair) => [pair.end, pair]))
  const contexts = new Map<number, Pair | undefined>()
  const active: Pair[] = []
  for (let i = 0; i <= source.length; i++) {
    if (ends.has(i)) active.pop()
    const pair = starts.get(i)
    if (pair) active.push(pair)
    if (source[i] === '[' || source[i] === ']') contexts.set(i, active.at(-1))
  }
  const literalBrackets = new Set<number>()
  for (const [start, end] of bracketPairs) {
    if (contexts.get(start) !== contexts.get(end)) {
      literalBrackets.add(start)
      literalBrackets.add(end)
    }
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    if (mask[i] === '{' && '+-=^~_*'.includes(source[i + 1] ?? '\0') && !validBraces.has(i) && !starts.has(i)) {
      if (i > 0 && source[i - 1] === '`' && mask[i - 1] === ' ' && /^\{=[^\s{}`]+\}/.test(source.slice(i))) continue
      literalBrackets.add(i)
      literalBrackets.add(i + 1)
    }
  }
  let literalPrefix = '\0DJOTLITERAL\0'
  while (source.includes(literalPrefix)) literalPrefix += '\0'
  const literals: string[] = []
  const bracketCloses = new Set(bracketPairs.map(([, close]) => close))
  const plain = (start: number, end: number): string => {
    let text = ''
    for (let i = start; i < end; i++) {
      const attrs = attributes.get(i)
      if (attrs && attrs.end <= end) {
        text += `${literalPrefix}${literals.length}\0`
        if (attrs.source === '{}') {
          const span = bracketCloses.has(i - 1) && !literalBrackets.has(i - 1)
          literals.push(span ? '{}' : listBoundaryComments.get(i) ?? (emptyBlockAttributes.has(i) ? '%%' : '{%%}'))
        } else literals.push(attrs.source)
        i = attrs.end - 1
        continue
      }
      const ch = source[i]!
      if (ch === '\\') { text += source.slice(i, Math.min(end, i + 2)); i++; continue }
      if (ch === '=' && (validBraceClosers.has(i) || validBraces.has(i - 1))) {
        text += `${literalPrefix}${literals.length}\0`
        literals.push(ch)
        continue
      }
      if (mask[i] === ch && (((ch === '~' || ch === '^') && source[i + 1] === '}' && !validBraceClosers.has(i)) || (ch === '_' || ch === '*') && !structural.has(i) || literalBrackets.has(i))) {
        text += `${literalPrefix}${literals.length}\0`
        literals.push(`\\${ch}`)
      } else text += literalDashes.has(i) ? '\\-' : ch
    }
    return text
  }
  const rendered = new Map<Pair, string>()
  const body = (start: number, end: number, children: Pair[], _outer: Set<string>): string => {
    let text = '',
      cursor = start
    for (const child of children) {
      text += plain(cursor, child.start) + rendered.get(child)!
      cursor = child.end
    }
    return text + plain(cursor, end)
  }
  const render = (pair: Pair, outer: Set<string>): string => {
    if (outer.has(pair.kind)) {
      flattened?.(pair.start)
      return body(pair.openEnd, pair.close, pair.children, outer)
    }
    const scope = pair.children.some((child) => [...child.kinds].some((kind) => outer.has(kind)))
    const content = body(
      pair.openEnd,
      pair.close,
      pair.children,
      scope ? new Set([pair.kind]) : new Set([...outer, pair.kind]),
    )
    const delimiter = pair.kind === '_' ? '/' : '*'
    const emptyBoundary =
      (mask[pair.end] === '{' && source.startsWith('{}', pair.end)) ||
      (mask[pair.start - 2] === '{' && source.slice(Math.max(0, pair.start - 2), pair.start) === '{}')
    const forced =
      pair.forced ||
      emptyBoundary ||
      scope ||
      content.startsWith('\0') ||
      content.endsWith('\0') ||
      /[A-Za-z0-9_]/.test(source[pair.start - 1] ?? '') ||
      /[A-Za-z0-9_]/.test(source[pair.end] ?? '') ||
      /^[ \t\r\n]|[ \t\r\n]$/.test(content) ||
      content.startsWith(delimiter) ||
      content.endsWith(delimiter) ||
      (delimiter === '/' && content.startsWith('*') && content.endsWith('*'))
    const protect = (value: string): string => {
      const token = `${literalPrefix}${literals.length}\0`
      literals.push(value)
      return token
    }
    return protect(forced ? `{${delimiter}` : delimiter) + content + protect(forced ? `${delimiter}}` : delimiter)
  }
  const work: Array<{ pair: Pair; outer: Set<string>; ready: boolean }> = roots
    .map((pair) => ({ pair, outer: new Set<string>(), ready: false }))
    .reverse()
  while (work.length) {
    const frame = work.pop()!
    if (frame.ready) {
      rendered.set(frame.pair, render(frame.pair, frame.outer))
      continue
    }
    work.push({ ...frame, ready: true })
    const scope = frame.pair.children.some((child) => [...child.kinds].some((kind) => frame.outer.has(kind)))
    const inner = frame.outer.has(frame.pair.kind)
      ? frame.outer
      : scope
        ? new Set([frame.pair.kind])
        : new Set([...frame.outer, frame.pair.kind])
    for (let i = frame.pair.children.length - 1; i >= 0; i--)
      work.push({ pair: frame.pair.children[i]!, outer: inner, ready: false })
  }
  return convert(body(0, source.length, roots, new Set())).replace(
    new RegExp(`${literalPrefix}(\\d+)\0`, 'g'),
    (_match, index: string) => literals[Number(index)]!,
  )
}

function maskFootnotes(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      const end = line.lastIndexOf(']') + 1
      return line.slice(0, end).replace(/\[\^[^\]\n]*\]/g, (value) => ' '.repeat(value.length)) + line.slice(end)
    })
    .join('\n')
}

function maskDjotEmphasisSource(source: string): string {
  const masked = maskDjotCodeAndDestinations(source).split('')
  let offset = 0, rawFence: string | undefined
  for (const line of source.split('\n')) {
    if (rawFence) {
      for (let i = offset; i < offset + line.length; i++) masked[i] = ' '
      if (new RegExp(`^[ \t]*${rawFence[0]}{${rawFence.length},}[ \t]*$`).test(line)) rawFence = undefined
    } else {
      const open = /^[ \t]*(`{3,}|~{3,})[ \t]*=html[ \t]*$/.exec(line)
      if (open) {
        rawFence = open[1]!
        for (let i = offset; i < offset + line.length; i++) masked[i] = ' '
      }
    }
    offset += line.length + 1
  }
  return masked.join('').replace(/!\[[^\[\]\n]*\](?=[([])/g, (value: string, at: number) => isDjotEscaped(source, at) || isDjotEscaped(source, at + value.length - 1) ? value : ' '.repeat(value.length))
}
