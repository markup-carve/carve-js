import { djotReferenceEmphasis } from './djot-emphasis.js'
import { maskDjotCodeAndDestinations } from './djot-migrate.js'
import { readAttributes } from './djot-word-attributes.js'
import { isDjotEscaped } from './djot-inline-boundaries.js'
import { parseRefLabelInlines } from './parse.js'
import { djotReferenceText } from './djot-reference-label.js'
import { escapePlainDjotText } from './djot-plain-text.js'

function imageLabelsAsLinks(source: string): string {
  const destinations = new Set<number>()
  const mask = maskDjotCodeAndDestinations(source, true, true, true, undefined, [], {
    onDestination: (start) => destinations.add(start),
  })
  const referenceEnds = new Int32Array(source.length + 1).fill(-1)
  let end = -1
  for (let at = source.length - 1; at >= 0; at--) {
    if (source[at] === '[' && !isDjotEscaped(source, at)) end = -1
    else if (source[at] === ']' && !isDjotEscaped(source, at)) end = at
    referenceEnds[at] = end
  }
  const brackets: number[] = []
  const removed = new Uint8Array(source.length)
  for (let at = 0; at < source.length; at++) {
    if (mask[at] !== source[at] || isDjotEscaped(source, at)) continue
    if (source[at] === '[') brackets.push(at)
    else if (source[at] === ']') {
      const open = brackets.pop()
      if (open === undefined || open === 0 || source[open - 1] !== '!' || isDjotEscaped(source, open - 1) || source[open + 1] === '^') continue
      if (destinations.has(at + 1) || source[at + 1] === '[' && referenceEnds[at + 2]! >= 0) removed[open - 1] = 1
    }
  }
  const parts: string[] = []
  let cursor = 0
  for (let at = 0; at < source.length; at++) if (removed[at]) { parts.push(source.slice(cursor, at)); cursor = at + 1 }
  return parts.join('') + source.slice(cursor)
}

export function djotImageLabelAttributes(source: string, flattenAttributeLines = false): string {
  const mask = maskDjotCodeAndDestinations(source, true, true, true, undefined, [], { comments: false, autolinks: false })
  const framed = 'DJOTALT ' + (flattenAttributeLines ? source.replaceAll('\n', ' ') : source)
  const symbols = /:[\w_+-]+:/y
  const autolinks = /<([^<>\s]+)>/y
  const parts: string[] = []
  let cursor = 0, noteEnd = -1
  for (let at = 0; at < source.length; at++) {
    if (mask[at] !== source[at] || isDjotEscaped(source, at)) continue
    if (source[at] === ':') {
      symbols.lastIndex = at
      const symbol = symbols.exec(source)
      if (symbol) { parts.push(source.slice(cursor, at), '{%%}'); cursor = symbols.lastIndex; at = cursor - 1; continue }
    }
    if (source[at] === '<') {
      autolinks.lastIndex = at
      const autolink = autolinks.exec(source)
      if (autolink && /[^:]@|[A-Za-z]:/.test(autolink[1]!)) {
        const body = autolink[1]!
        let width = 1
        for (const run of body.matchAll(/`+/g)) width = Math.max(width, run[0].length + 1)
        const ticks = '`'.repeat(width)
        parts.push(source.slice(cursor, at), ticks + ' ' + body + ' ' + ticks)
        cursor = autolinks.lastIndex; at = cursor - 1; continue
      }
    }
    if (source[at] === '[' && source[at + 1] === '^' && !(at !== noteEnd && at > 0 && source[at - 1] === ']' && !isDjotEscaped(source, at - 1))) {
      let end = at + 2
      while (end < source.length && !(mask[end] === source[end] && !isDjotEscaped(source, end) && (source[end] === '[' || source[end] === ']'))) end++
      if (source[end] === ']') {
        parts.push(source.slice(cursor, at), '{%%}')
        cursor = noteEnd = end + 1
        at = cursor - 1
        continue
      }
    }
    if (source[at] !== '{') continue
    const attrs = readAttributes(framed, at + 8)
    if (!attrs) continue
    parts.push(source.slice(cursor, at), at !== noteEnd && source[at - 1] === ']' && !isDjotEscaped(source, at - 1) ? '{}' : '{%%}')
    cursor = attrs.end - 8
    at = cursor - 1
  }
  return parts.join('') + source.slice(cursor)
}

export function djotCollapsedReferenceText(source: string, quoteDepth = 0): string {
  if (quoteDepth && source.includes('\n')) source = source.replace(/\n([^\n]*)/g, (_all, line: string) => {
    for (let n = 0; n < quoteDepth; n++) {
      const prefix = /^[ \t]*>(?:[ \t]|$)/.exec(line)
      if (!prefix) break
      line = line.slice(prefix[0].length)
    }
    return '\n' + line
  })
  return djotReferenceText(parseRefLabelInlines(djotReferenceEmphasis(imageLabelsAsLinks(djotImageLabelAttributes(source)), escapePlainDjotText)))
}

export function djotCollapsedReferenceCache(): (source: string, quoteDepth?: number) => string {
  const cache = new Map<string, string>()
  return (source, quoteDepth = 0) => {
    if (source.length > 256) return djotCollapsedReferenceText(source, quoteDepth)
    const key = quoteDepth + ':' + source
    let value = cache.get(key)
    if (value === undefined) { value = djotCollapsedReferenceText(source, quoteDepth); cache.set(key, value) }
    return value
  }
}
