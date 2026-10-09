import { backtickRunEnds } from './backtick-run-index.js'
import { readAttributes } from './djot-word-attributes.js'

export interface DjotOpaqueOptions {
  comments?: boolean
  code?: boolean
  destinations?: boolean
  autolinks?: boolean
  attributeValues?: boolean
  onComment?: (start: number, end: number) => void
}

/** Mask opaque inline payloads while preserving source offsets and newlines. */
export function maskDjotOpaque(source: string, unclosedCode: boolean, options: DjotOpaqueOptions = {}): string {
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
      if (source[at + 1] === '%' && options.comments !== false) {
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
      if (source[at + 1] === '(') {
        let end = at + 2,
          depth = 1
        const lineStart = source.lastIndexOf('\n', at) + 1
        const table = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+)?\|/.test(source.slice(lineStart, at))
        for (; end < (breaks[boundary] ?? source.length); end++) {
          if (
            (table && (source[end] === '|' || source[end] === '`')) ||
            (source[at + 2] === '<' && source[end] === '`')
          )
            break
          if (source[end] === '\\') end++
          else if (source[end] === '(') depth++
          else if (source[end] === ')' && --depth === 0) break
        }
        if (!depth) {
          if (options.destinations !== false) hide(at + 1, end + 1)
          at = end
          continue
        }
      }
      if (
        source[at + 1] === ':' &&
        /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|[0-9A-Za-z]+[.)])[ \t]+)?\[(?!\^)[^\]\n]+$/.test(
          source.slice(source.lastIndexOf('\n', at) + 1, at),
        )
      ) {
        const lineStart = source.lastIndexOf('\n', at) + 1
        const previousStart = source.lastIndexOf('\n', lineStart - 2) + 1
        const previous = source.slice(previousStart, lineStart - 1).trim()
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
    const raw = /^\{=[^}\n]*\}/.exec(source.slice(end))
    const math = source[at - 1] === '$'
    if (options.code !== false || raw || math) hide(at - (math ? 1 : 0), end)
    at = end + (raw?.[0].length ?? 0) - 1
  }
  return out.join('')
}
