import { djotStructuralPrefixEnd } from './djot-structural-prefix.js'

const commentEnd = /[%}]/g

const quoteValue = (value: string, carve = false): string => `"${value.replace(carve ? /[!-\/:-@\[-`{-~]/g : /[\\"]/g, char => '\\' + char)}"`

export function attributeContext(source: string, start: number): { depth: number; indent: number | undefined; minimum: number } {
  let prefix = source.slice(source.lastIndexOf('\n', start - 1) + 1, start), depth = 0
  if (!prefix) return { depth: 0, indent: 0, minimum: 0 }
  const enclosingItem = /^[ \t]*(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+(?=>)/.exec(prefix)
  if (enclosingItem) prefix = prefix.slice(enclosingItem[0].length)
  while (true) { const quote = /^[ \t]*>(?:[ \t]|$)/.exec(prefix); if (!quote) break; prefix = prefix.slice(quote[0].length); depth++ }
  const marker = /^[ \t]*(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.exec(prefix)
  return { depth, indent: /^(?:[ \t]*(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+)?[ \t]*$/.test(prefix) ? prefix.length : undefined, minimum: marker?.[0].length ?? 0 }
}
function attributeLine(line: string, depth: number): string | undefined {
  for (let n = 0; n < depth; n++) { const quote = /^[ \t]*>(?:[ \t]|$)/.exec(line); if (!quote) return undefined; line = line.slice(quote[0].length) }
  return line
}

let paragraphSource = ''
const paragraphStarts = new Map<number, { key: string; result: boolean }>()

export function resetParagraphContext(): void { paragraphSource = ''; paragraphStarts.clear() }

export function continuesParagraph(source: string, start: number): boolean {
  if (paragraphSource !== source) paragraphStarts.clear()
  paragraphSource = source
  const context = attributeContext(source, start)
  const key = `${context.depth}:${context.indent}:${context.minimum}`
  const from = source.lastIndexOf('\n', start - 1) + 1
  const cached = paragraphStarts.get(from)
  if (cached?.result && cached.key === key) return true
  const result = scanParagraph(source, start, key)
  paragraphStarts.set(from, {key, result})
  return result
}

function scanParagraph(source: string, start: number, key: string): boolean {
  const context = attributeContext(source, start)
  if (context.indent === undefined) return true
  const marker = /^(?:[ \t]*>[ \t]*)*[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|[ivxlcdmIVXLCDM]+)[.)]|\((?:[0-9]+|[A-Za-z]|[ivxlcdmIVXLCDM]+)\))[ \t]+/
  let end = source.lastIndexOf('\n', start - 1)
  const prefix = source.slice(end + 1, start)
  if (marker.test(prefix)) return false
  const lines: { raw: string; from: number }[] = []
  while (end >= 0) {
    const from = source.lastIndexOf('\n', end - 1) + 1
    const raw = source.slice(from, end)
    const depth = raw.match(/^[ \t]*(?:>[ \t]*)+/)?.[0].match(/>/g)?.length ?? 0
    if (depth !== context.depth) return false
    if (!raw.slice(djotStructuralPrefixEnd(raw)).trim()) {
      let parentEnd = from - 1
      while (parentEnd >= 0) {
        const parentFrom = source.lastIndexOf('\n', parentEnd - 1) + 1
        const parent = source.slice(parentFrom, parentEnd)
        const owner = marker.exec(parent)
        if (owner) {
          const column = /^(?:[ \t]*>[ \t]*)*[ \t]*/.exec(parent)![0].length
          if (lines.length && prefix.length <= column && djotStructuralPrefixEnd(lines.at(-1)!.raw) > column) return false
          break
        }
        if (!parent.trim()) break
        parentEnd = parentFrom - 1
      }
      break
    }
    const cached = paragraphStarts.get(from)
    if (cached?.key === key) {
      if (cached.result) return true
      const attrs = readAttributes(source, from + djotStructuralPrefixEnd(raw), false, false, false)
      if (attrs && attrs.end <= start) {
        while (lines.length && lines.at(-1)!.from < attrs.end) lines.pop()
        break
      }
    }
    lines.push({ raw, from })
    end = from - 1
  }
  let kind: 'paragraph' | 'heading' | 'fence' | undefined
  let fence = '', attributeEnd = -1
  for (const { raw, from } of lines.reverse()) {
    if (from < attributeEnd) continue
    const item = marker.exec(raw)
    if (kind === 'paragraph') continue
    if (item && prefix.length <= /^(?:[ \t]*>[ \t]*)*[ \t]*/.exec(raw)![0].length) return false
    const bodyAt = djotStructuralPrefixEnd(raw)
    const body = raw.slice(bodyAt)
    if (kind === 'fence') { if (body.startsWith(fence)) kind = undefined; continue }
    if (body.startsWith('{')) {
      const attrs = readAttributes(source, from + bodyAt, false, false, false)
      if (attrs) { attributeEnd = attrs.end; kind = undefined; continue }
    }
    if (/^#{1,6}(?:[ \t]|$)/.test(body)) { kind = 'heading'; continue }
    const opened = /^(`{3,}|~{3,})/.exec(body)
    if (opened) { kind = 'fence'; fence = opened[1]!; continue }
    if (body.startsWith('{%') && readAttributes(body + '}', 0, false, false, false)) { kind = 'paragraph'; continue }
    if (kind === 'heading') continue
    if (/^:[ \t]/.test(body)) {
      if (prefix.length <= bodyAt) return false
      kind = body.slice(1).trim() ? 'paragraph' : undefined
      continue
    }
    const note = /^\[\^[^\]]+\]:[ \t]*(.*)$/.exec(body)
    if (note) {
      if (prefix.length < bodyAt + 2) return false
      kind = note[1]!.trim() ? 'paragraph' : undefined
      continue
    }
    if (/^(?::::|\||\[[^\]]*\]:|:[ \t]|(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$)/.test(body)) { kind = undefined; continue }
    kind = 'paragraph'
  }
  return kind === 'paragraph'
}

export type DjotAttributeToken = { key: string; source: string; append: boolean }

export function readAttributes(source: string, start: number, carve = false, table = false, paragraphContext = true): { end: number; source: string; tokens: DjotAttributeToken[] } | undefined {
  const parts: string[] = []
  const tokens: DjotAttributeToken[] = []
  let i = start + 1
  let context: ReturnType<typeof attributeContext> | undefined
  while (i < source.length) {
    while (/[ \t\n\r]/.test(source[i] ?? '') && i < source.length) {
      if (source[i] === '\n' && /^[ \t]*\n/.test(source.slice(i + 1))) return undefined
      if (source[i] === '\n') {
        context ??= attributeContext(source, start)
        i++
        for (let n = 0; n < context.depth; n++) { const quote = /^[ \t]*>(?:[ \t]|$)/.exec(source.slice(i)); if (!quote) break; i += quote[0].length }
      } else i++
    }
    if (source[i] === '}' && source.slice(start, i + 1).includes('\n')) {
      const heldContext = context ??= attributeContext(source, start)
      const invalid = source.slice(start, i + 1).split('\n').slice(1).some(raw => {
        const line = attributeLine(raw, heldContext.depth)
        if (heldContext.indent !== undefined && line === undefined) return true
        const indent = /^[ \t]*/.exec(line ?? raw)![0].length
        return heldContext.indent !== undefined && (indent < heldContext.minimum || indent <= heldContext.indent)
      })
      if (invalid && (parts.length > 0 || !paragraphContext || !continuesParagraph(source, start))) return undefined
    }
    if (source[i] === '}') {
      if (carve && table) {
        for (let at = start; at <= i; at++) {
          if (source[at] === '\\') at++
          else if (source[at] === '|') return undefined
        }
      }
      return { end: i + 1, source: `{${parts.join(' ')}}`, tokens }
    }
    if (source[i] === '%') {
      commentEnd.lastIndex = i + 1
      const end = commentEnd.exec(source)?.index ?? source.length
      if (end === source.length || /\n[ \t]*\n/.test(source.slice(i, end))) return undefined
      i = source[end] === '%' ? end + 1 : end
      continue
    }
    if (source[i] === '#' || source[i] === '.') {
      const kind = source[i++]!
      const from = i
      while (i < source.length && !(kind === '#' ? /[\]\[~!@#$%^&*(){}`,.<>\\|=+/?\s]/u : /[^A-Za-z0-9_:-]/).test(source[i]!)) i++
      if (i === from) return undefined
      const value = source.slice(from, i)
      if (kind === '#' ? /[\]\[~!@#$%^&*(){}`,.<>\\|=+/?\s]/u.test(value) : !/^[A-Za-z0-9_:-]+$/.test(value)) return undefined
      parts.push(/^[A-Za-z0-9_][\w-]*$/.test(value) ? kind + value : `${kind === '#' ? 'id' : 'class'}=${quoteValue(value, carve)}`)
      tokens.push({ key: kind === '#' ? 'id' : 'class', source: parts.at(-1)!, append: kind === '.' })
    } else {
      const tokenStart = i
      const key = /^[A-Za-z][A-Za-z0-9_-]*=/.exec(source.slice(i))
      if (!key) return undefined
      i += key[0].length
      const from = i
      if (source[i] === '"') {
        i++
        while (i < source.length && source[i] !== '"') {
          if (source[i] === '\n' && /^[ \t]*\n/.test(source.slice(i + 1))) return undefined
          if (source[i] === '\\') i++
          i++
        }
        if (source[i] !== '"') return undefined
        i++
        let value = source.slice(from + 1, i - 1)
        if (value.includes('\n')) {
          const context = attributeContext(source, start)
          value = value.replace(/\r?\n([^\n]*)/g, (_match, raw: string) => ' ' + (attributeLine(raw, context.depth) ?? raw).replace(/^[ \t]+/, ''))
        }
        value = value.replace(/[ \r\n]+/g, ' ').replace(/\\([.,\\/#!$%^&*;:{}=\-_`~+[\]()'"?|])/g, '$1')
        parts.push(key[0] + quoteValue(value, carve))
      } else {
        while (i < source.length && /[A-Za-z0-9_:-]/.test(source[i]!)) i++
        if (i === from) return undefined
        parts.push(key[0] + quoteValue(source.slice(from, i), carve))
      }
      tokens.push({ key: key[0].slice(0, -1), source: source[tokenStart + key[0].length] === '"' || source.slice(tokenStart, i).includes('\n') ? parts.at(-1)! : source.slice(tokenStart, i), append: false })
    }
    if (i < source.length && !/[\s}%]/u.test(source[i]!)) return undefined
  }
  return undefined
}

export function nativeAttributeReader(source: string): (start: number) => ReturnType<typeof readAttributes> {
  let lineEnd = -1, table = false
  return start => {
    while (lineEnd < start) {
      const lineStart = lineEnd + 1
      const newline = source.indexOf('\n', lineStart)
      lineEnd = newline < 0 ? source.length : newline
      const line = source.slice(lineStart, lineEnd)
      table = line[djotStructuralPrefixEnd(line)] === '|'
    }
    return readAttributes(source, start, true, table)
  }
}


export function rejectedCommentStartsBlock(line: string): boolean {
  const match = /^\\\{\0DJOTINVALIDATTR\0[0-9]+\0(%[^\n]*)/.exec(line)
  return !!match && readAttributes('{' + match[1] + '}', 0) !== undefined
}
