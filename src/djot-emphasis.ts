import { isDjotEscaped, maskDjotCodeAndDestinations } from './djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'

type Pair = { start: number; openEnd: number; close: number; end: number; kind: string; forced: boolean; children: Pair[]; kinds: Set<string> }
type Opener = { start: number; end: number; kind: string; forced: boolean }

export const djotStructuralPrefixSteps = { count: 0 }

export function djotStructuralPrefixEnd(line: string): number {
  let at = 0
  const spaces = () => {
    while (line[at] === ' ' || line[at] === '\t') { at++; djotStructuralPrefixSteps.count++ }
  }
  do { spaces(); if (line[at] !== '>') break; at++; djotStructuralPrefixSteps.count++ } while (at < line.length)
  spaces()
  for (;;) {
    djotStructuralPrefixSteps.count++
    const start = at
    let end = at
    if ('-*+'.includes(line[end] ?? '\0')) end++
    else {
      while (line[end] !== undefined && line[end]! >= '0' && line[end]! <= '9') { end++; djotStructuralPrefixSteps.count++ }
      if (end === start || line[end] !== '.' && line[end] !== ')') break
      end++
    }
    if (line[end] !== ' ' && line[end] !== '\t') break
    at = end; spaces()
    if (line[at] === '[' && ' xX-'.includes(line[at + 1] ?? '\0') && line[at + 2] === ']' && (line[at + 3] === ' ' || line[at + 3] === '\t')) {
      at += 3; djotStructuralPrefixSteps.count += 3; spaces()
    }
  }
  return at
}

export function djotEmphasis(source: string, convert: (plain: string) => string): string {
  const mask = maskFootnotes(maskDjotEmphasisSource(source)).replace(/<[^<>\s]+>/g, value => /[^:]@|[A-Za-z]:/.test(value) ? ' '.repeat(value.length) : value).replace(/(?<=\])\[[^\]\n]*\]/gm, value => ' '.repeat(value.length)).split('')
  for (let i = 0; i < source.length; i++) {
    if (mask[i] !== '{' || !/[.#A-Za-z]/.test(source[i + 1] ?? '')) continue
    const attrs = readAttributes(source, i)
    if (!attrs) continue
    for (let at = i; at < attrs.end; at++) if (mask[at] !== '\n') mask[at] = ' '
    i = attrs.end - 1
  }
  const validBraces = new Set<number>(), pendingBraces = new Map<string, number[]>()
  let braceLineStart = 0, lastEscaped = -1
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      if (source.slice(braceLineStart, i).replace(/^(?:[ \t]*>)*[ \t]*/, '').trim() === '') pendingBraces.clear()
      braceLineStart = i + 1
    }
    if (mask[i] !== source[i]) continue
    if (source[i] === '\\' && source[i + 1] !== '\n') { lastEscaped = i + 1; i++; continue }
    if (source[i] === '{' && '+-=^~'.includes(source[i + 1] ?? '\0')) {
      const kind = source[i + 1]!, stack = pendingBraces.get(kind) ?? []
      stack.push(i); pendingBraces.set(kind, stack)
    } else if (source[i] === '}' && i - 1 !== lastEscaped && '+-=^~'.includes(source[i - 1] ?? '\0')) {
      const start = pendingBraces.get(source[i - 1]!)?.pop()
      if (start !== undefined && i > start + 2) validBraces.add(start)
    }
  }
  const openers = new Map<string, Opener[]>(['_', '*', '{_', '{*'].map(key => [key, []]))
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
      if (line.trim() && listColumn !== undefined && indent < listColumn && !/^[ \t]*(?:[-*+] |[0-9]+[.)] )/.test(line)) listColumn = undefined
      const marker = /^[ \t]*(?:[-*+][ \t]|[0-9]+[.)][ \t]|\|)/.test(line)
      if (marker && (previousBlank || container)) { clear(0); container = true }
      else if (previousBlank) container = listColumn !== undefined && indent >= listColumn
      if (marker && container) { const item = /^[ \t]*(?:[-*+]|[0-9]+[.)])[ \t]+/.exec(line); if (item) listColumn = item[0].length }
      if (/^[ \t]*(?:`{3,}|~{3,})/.test(line) || (previousBlank || container) && /^[ \t]*(?::{3,})/.test(line) || /^[ \t]*#{1,6}[ \t]/.test(line)) clear(0)
      previousBlank = line.trim() === '' || /^[ \t]*(?:`{3,}|~{3,}|:{3,}|\{[.#A-Za-z])/.test(line)
    }
    const ch = source[i]!
    if (ch === '\n') {
      if (source.slice(lineStart, i).replace(/^(?:[ \t]*>)*[ \t]*/, '').trim() === '') { clear(0); brackets.length = 0; braces.length = 0 }
      lineStart = i + 1
      continue
    }
    if (ch === '\\' && source[i + 1] !== '\n') { i++; continue }
    if (mask[i] !== ch) continue
    if (ch === '{' && validBraces.has(i)) { braces.push(i); continue }
    if (ch === '}' && braces.at(-1) !== undefined && source[i - 1] === source[braces.at(-1)! + 1]) { clear(braces.pop()!); continue }
    if (ch === '[') { brackets.push(i); continue }
    if (ch === ']') {
      const start = brackets.pop()
      if (start !== undefined) { clear(start); bracketPairs.push([start, i]) }
      continue
    }
    if (ch !== '_' && ch !== '*') continue
    if (ch === '*' && i <= structuralEnd) {
      if (thematicLine) {
        for (let at = i; at < lineEnd; at++) if (source[at] === '*') structural.add(at)
        i = lineEnd - 1
        continue
      }
      if (/[ \t]/.test(source[i + 1] ?? '')) { structural.add(i); continue }
    }
    const forcedOpen = source[i - 1] === '{' && mask[i - 1] === '{'
    const forcedClose = source[i + 1] === '}'
    const canOpen = forcedOpen || (!forcedClose && source[i + 1] !== undefined && !/[ \t\r\n]/.test(source[i + 1]!))
    const canClose = !forcedOpen && (forcedClose || (i > 0 && !/[ \t\r\n]/.test(source[i - 1]!)))
    const stack = openers.get((forcedClose ? '{' : '') + ch)!
    const opener = stack.at(-1)
    if (canClose && opener && opener.end < i && opener.start > (braces.at(-1) ?? -1)) {
      clear(opener.start)
      pairs.push({ start: opener.start, openEnd: opener.end, close: i, end: i + (forcedClose ? 2 : 1), kind: ch, forced: opener.forced, children: [], kinds: new Set([ch]) })
      if (forcedClose) i++
    } else if (canOpen) {
      openers.get((forcedOpen ? '{' : '') + ch)!.push({ start: i - (forcedOpen ? 1 : 0), end: i + 1, kind: ch, forced: forcedOpen })
    } else if (forcedClose) i++
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
  for (let i = pairs.length - 1; i >= 0; i--) for (const child of pairs[i]!.children) for (const kind of child.kinds) pairs[i]!.kinds.add(kind)
  const starts = new Map(pairs.map(pair => [pair.start, pair]))
  const ends = new Map(pairs.map(pair => [pair.end, pair]))
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
  const plain = (start: number, end: number): string => {
    let text = ''
    for (let i = start; i < end; i++) {
      const ch = source[i]!
      if (ch === '\\') { text += source.slice(i, Math.min(end, i + 2)); i++; continue }
      if (mask[i] === ch && ((ch === '_' || ch === '*') && !structural.has(i) || literalBrackets.has(i))) {
        text += `${literalPrefix}${literals.length}\0`
        literals.push(`\\${ch}`)
      } else text += ch
    }
    return text
  }
  const rendered = new Map<Pair, string>()
  const body = (start: number, end: number, children: Pair[], _outer: Set<string>): string => {
    let text = '', cursor = start
    for (const child of children) {
      text += plain(cursor, child.start) + rendered.get(child)!
      cursor = child.end
    }
    return text + plain(cursor, end)
  }
  const render = (pair: Pair, outer: Set<string>): string => {
    if (outer.has(pair.kind)) return body(pair.openEnd, pair.close, pair.children, outer)
    const scope = pair.children.some(child => [...child.kinds].some(kind => outer.has(kind)))
    const content = body(pair.openEnd, pair.close, pair.children, scope ? new Set([pair.kind]) : new Set([...outer, pair.kind]))
    const delimiter = pair.kind === '_' ? '/' : '*'
    const forced = pair.forced || scope || content.startsWith('\0') || content.endsWith('\0') || /[A-Za-z0-9_]/.test(source[pair.start - 1] ?? '') || /[A-Za-z0-9_]/.test(source[pair.end] ?? '') || /^[ \t\r\n]|[ \t\r\n]$/.test(content) || content.startsWith(delimiter) || content.endsWith(delimiter) || (delimiter === '/' && content.startsWith('*') && content.endsWith('*'))
    const protect = (value: string): string => {
      const token = `${literalPrefix}${literals.length}\0`
      literals.push(value)
      return token
    }
    return protect(forced ? `{${delimiter}` : delimiter) + content + protect(forced ? `${delimiter}}` : delimiter)
  }
  const work: Array<{ pair: Pair; outer: Set<string>; ready: boolean }> = roots.map(pair => ({ pair, outer: new Set<string>(), ready: false })).reverse()
  while (work.length) {
    const frame = work.pop()!
    if (frame.ready) { rendered.set(frame.pair, render(frame.pair, frame.outer)); continue }
    work.push({ ...frame, ready: true })
    const scope = frame.pair.children.some(child => [...child.kinds].some(kind => frame.outer.has(kind)))
    const inner = frame.outer.has(frame.pair.kind) ? frame.outer : scope ? new Set([frame.pair.kind]) : new Set([...frame.outer, frame.pair.kind])
    for (let i = frame.pair.children.length - 1; i >= 0; i--) work.push({ pair: frame.pair.children[i]!, outer: inner, ready: false })
  }
  return convert(body(0, source.length, roots, new Set())).replace(new RegExp(`${literalPrefix}(\\d+)\0`, 'g'), (_match, index: string) => literals[Number(index)]!)
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

function maskFootnotes(source: string): string {
  return source.split('\n').map(line => {
    const end = line.lastIndexOf(']') + 1
    return line.slice(0, end).replace(/\[\^[^\]\n]*\]/g, value => ' '.repeat(value.length)) + line.slice(end)
  }).join('\n')
}
