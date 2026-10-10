import { djotSimpleDestinationRanges, djotDestinationRanges } from './djot-inline-boundaries.js'
import { backtickRunEnds } from './backtick-run-index.js'
import { readAttributes } from './djot-word-attributes.js'

export interface DjotOpaqueOptions {
  comments?: boolean
  code?: boolean
  destinations?: boolean
  inlineDestinations?: boolean
  autolinks?: boolean
  attributeValues?: boolean
  onComment?: (start: number, end: number) => void
  onDestination?: (start: number, end: number) => void
}

/** Mask opaque inline payloads while preserving source offsets and newlines. */
export function maskDjotOpaque(source: string, unclosedCode: boolean, options: DjotOpaqueOptions = {}): string {
  const destinations = options.destinations !== false && options.inlineDestinations !== false ? djotSimpleDestinationRanges(source) ?? djotDestinationRanges(source, maskDjotOpaque(source, unclosedCode, { destinations: false, autolinks: false, attributeValues: false, comments: false })) : new Map<number, number>()
  const definitionLines = new Map<number, { start: number; previous: string }>()
  let lineOffset = 0, previousLine = ''
  if (source.includes(']:')) {
    for (const line of source.split('\n')) {
      const definition = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+)?\[(?!\^)[^\]\n]+\](?=:)/.exec(line)
      if (definition) definitionLines.set(lineOffset + definition[0].length - 1, { start: lineOffset, previous: previousLine.trim() })
      lineOffset += line.length + 1
      previousLine = line
    }
  }
  const rawFormats = new Map<number, number>()
  if (source.includes('{=')) {
    let rawEnd = -1
    for (let at = source.length - 1; at >= 0; at--) {
      if (source[at] === '}') rawEnd = at + 1
      else if (source[at] === '\n') rawEnd = -1
      if (source[at] === '{' && source[at + 1] === '=' && rawEnd >= 0) rawFormats.set(at, rawEnd)
    }
  }
  const lastBrace = source.lastIndexOf('}')
  const out = source.split('')
  const hide = (start: number, end: number): void => {
    for (let at = start; at < end; at++) if (out[at] !== '\n') out[at] = ' '
  }
  const breaks = [...source.matchAll(/\n[ \t]*(?:>[ \t]*)*\n/g)].map((match) => match.index!)
  let boundary = 0
  const brackets: number[] = []
  let ends: Int32Array | undefined
  for (let at = 0; at < source.length; at++) {
    while ((breaks[boundary] ?? source.length) <= at) {
      boundary++
      brackets.length = 0
    }
    const destinationEnd = destinations.get(at)
    if (destinationEnd !== undefined) { options.onDestination?.(at, destinationEnd); hide(at, destinationEnd); at = destinationEnd - 1; continue }
    if (source[at] === '\\') {
      at++
      continue
    }
    if (source[at] === '<') {
      const angle = /^<[^<>\s]+>/.exec(source.slice(at))
      if (angle && /[^:]@|[A-Za-z]:/.test(angle[0])) {
        const end = at + angle[0].length
        if (options.autolinks !== false) hide(at, end)
        at = end - 1
        continue
      }
    }
    if (source[at] === '{') {
      if (source[at + 1] === '%' && options.comments !== false && at < lastBrace) {
        let end = at + 2
        while (end < source.length && source[end] !== '}' && !(source[end] === '%' && source[end + 1] === '}')) end++
        if (source[end] === '%') end++
        if (source[end] === '}') {
          options.onComment?.(at, end + 1)
          hide(at + 1, end)
          at = end
          continue
        }
      }
      const attrs = readAttributes(source, at)
      if (attrs) {
        for (const value of source.slice(at, attrs.end).matchAll(/=\s*("(?:\\.|[^"\\])*"|[^\s{}%]+)/g)) {
          const start = at + value.index! + value[0].indexOf(value[1]!)
          if (options.attributeValues !== false) hide(start, start + value[1]!.length)
        }
        at = attrs.end - 1
        continue
      }
    }
    if (source[at] === '[') {
      brackets.push(at)
      continue
    }
    if (source[at] === ']' && brackets.length) {
      brackets.pop()
      const definition = definitionLines.get(at)
      if (definition) {
        const { start: lineStart, previous } = definition
        if (lineStart && previous && !/^(?:#{1,6} |:{3,}|[`~]{3,}|\{|\[[^\]]+\]:|(?:[*-][ \t]*){3,}$)/.test(previous))
          continue
        const newline = source.indexOf('\n', at)
        const end = newline < 0 ? source.length : newline
        if (options.destinations !== false) hide(at + 2, end)
        at = end - 1
        continue
      }
    }
    if (source[at] !== '`') continue
    let width = 1
    while (source[at + width] === '`') width++
    ends ??= backtickRunEnds(source)
    const end = ends?.[at] ?? -1
    const paragraphEnd = breaks[boundary] ?? source.length
    if (end < 0 || end - width >= paragraphEnd) {
      if (unclosedCode && options.code !== false) {
        hide(at, paragraphEnd)
        at = paragraphEnd - 1
      } else at += width - 1
      continue
    }
    const rawEnd = rawFormats.get(end)
    const math = source[at - 1] === '$'
    if (options.code !== false || rawEnd !== undefined || math) hide(at - (math ? 1 : 0), end)
    at = (rawEnd ?? end) - 1
  }
  return out.join('')
}
