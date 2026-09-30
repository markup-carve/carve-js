import { maskDjotCodeAndDestinations } from './djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'

type Pair = { start: number; openEnd: number; close: number; end: number; kind: string; forced: boolean; children: Pair[]; kinds: Set<string> }
type Opener = { start: number; end: number; kind: string; forced: boolean }

export function djotEmphasis(source: string, convert: (plain: string) => string): string {
  const mask = maskDjotEmphasisSource(source).replace(/<[^<>\s]+>/g, value => /[^:]@|[A-Za-z]:/.test(value) ? ' '.repeat(value.length) : value).replace(/\[\^[^\]\n]*\]|(?<=\])\[[^\]\n]*\]|^[ \t]*\[[^\]\n]*\]:(?=[ \t]|$)[^\n]*/gm, value => ' '.repeat(value.length)).split('')
  for (let i = 0; i < source.length; i++) {
    if (mask[i] !== '{' || !/[.#A-Za-z]/.test(source[i + 1] ?? '')) continue
    const attrs = readAttributes(source, i)
    if (!attrs) continue
    for (let at = i; at < attrs.end; at++) if (mask[at] !== '\n') mask[at] = ' '
    i = attrs.end - 1
  }
  const openers = new Map<string, Opener[]>(['_', '*', '{_', '{*'].map(key => [key, []]))
  const pairs: Pair[] = []
  const structural = new Set<number>()
  const brackets: number[] = []
  const bracketPairs: Array<[number, number]> = []
  let lineStart = 0
  const clear = (from: number): void => {
    for (const stack of openers.values()) while (stack.at(-1) && stack.at(-1)!.start >= from) stack.pop()
  }
  for (let i = 0; i < source.length; i++) {
    if (i === lineStart && /^(?:[ \t]*>[ \t]*)*[ \t]*(?:`{3,}|~{3,}|:{3,}|#{1,6}[ \t]|[-*+][ \t]|[0-9]+[.)][ \t]|\|)/.test(source.slice(i, source.indexOf('\n', i) < 0 ? source.length : source.indexOf('\n', i)))) clear(0)
    const ch = source[i]!
    if (ch === '\n') {
      if (source.slice(lineStart, i).replace(/^(?:[ \t]*>[ \t]*)*/, '').trim() === '') clear(0)
      lineStart = i + 1
      continue
    }
    if (ch === '\\' && source[i + 1] !== '\n') { i++; continue }
    if (mask[i] !== ch) continue
    if (ch === '[') { brackets.push(i); continue }
    if (ch === ']') {
      const start = brackets.pop()
      if (start !== undefined) { clear(start); bracketPairs.push([start, i]) }
      continue
    }
    if (ch !== '_' && ch !== '*') continue
    if (ch === '*' && /^(?:[ \t]*>[ \t]*)*[ \t]*$/.test(source.slice(lineStart, i))) {
      const end = source.indexOf('\n', i)
      const line = source.slice(lineStart, end < 0 ? source.length : end)
      if (/^(?:[ \t]*>[ \t]*)*[ \t]*(?:\*[ \t]*){3,}$/.test(line)) {
        for (let at = i; at < lineStart + line.length; at++) if (source[at] === '*') structural.add(at)
        i = lineStart + line.length - 1
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
    if (canClose && opener && opener.end < i) {
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
  return masked.join('').replace(/!\[[^\]\n]*\]/g, value => ' '.repeat(value.length))
}
