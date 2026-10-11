import { djotStructuralPrefixEnd } from './djot-structural-prefix.js'

const commentEnd = /[%}]/g

const quoteValue = (value: string, carve = false): string => `"${value.replace(carve ? /[!-\/:-@\[-`{-~]/g : /[\\"]/g, char => '\\' + char)}"`

export function attributeContext(source: string, start: number): { depth: number; indent: number | undefined; minimum: number } {
  let prefix = source.slice(source.lastIndexOf('\n', start - 1) + 1, start), depth = 0
  if (!prefix) return { depth: 0, indent: 0, minimum: 0 }
  const enclosingItem = /^[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|(?:[ivxlcdm]+|[IVXLCDM]+))[.)]|\((?:[0-9]+|[A-Za-z]|(?:[ivxlcdm]+|[IVXLCDM]+))\))[ \t]+(?=>)/.exec(prefix)
  if (enclosingItem) prefix = prefix.slice(enclosingItem[0].length)
  while (true) { const quote = /^[ \t]*>(?:[ \t]|$)/.exec(prefix); if (!quote) break; prefix = prefix.slice(quote[0].length); depth++ }
  const marker = /^[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|(?:[ivxlcdm]+|[IVXLCDM]+))[.)]|\((?:[0-9]+|[A-Za-z]|(?:[ivxlcdm]+|[IVXLCDM]+))\))[ \t]+/.exec(prefix)
  return { depth, indent: /^(?:[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|(?:[ivxlcdm]+|[IVXLCDM]+))[.)]|\((?:[0-9]+|[A-Za-z]|(?:[ivxlcdm]+|[IVXLCDM]+))\))[ \t]+)?[ \t]*$/.test(prefix) ? prefix.length : undefined, minimum: marker?.[0].length ?? 0 }
}
function attributeLine(line: string, depth: number): string | undefined {
  for (let n = 0; n < depth; n++) { const quote = /^[ \t]*>(?:[ \t]|$)/.exec(line); if (!quote) return undefined; line = line.slice(quote[0].length) }
  return line
}

let paragraphSource = ''
const paragraphStarts = new Map<number, { key: string; result: boolean; start: number }>()

export function resetParagraphContext(): void { paragraphSource = ''; paragraphStarts.clear() }

export function continuesParagraph(source: string, start: number, context = attributeContext(source, start)): boolean {
  if (paragraphSource !== source) paragraphStarts.clear()
  paragraphSource = source
  if (context.indent === undefined) return true
  const key = `${context.depth}:${context.indent}:${context.minimum}`
  const from = source.lastIndexOf('\n', start - 1) + 1
  const cached = paragraphStarts.get(from)
  if (cached?.key === key && cached.start === start) return cached.result
  const result = scanParagraph(source, start, key, context)
  paragraphStarts.set(from, {key, result, start})
  return result
}

function scanParagraph(source: string, start: number, key: string, context: ReturnType<typeof attributeContext>): boolean {
  const marker = /^(?:[ \t]*>[ \t]*)*[ \t]*(?:[-*+]|(?:[0-9]+|[A-Za-z]|(?:[ivxlcdm]+|[IVXLCDM]+))[.)]|\((?:[0-9]+|[A-Za-z]|(?:[ivxlcdm]+|[IVXLCDM]+))\))[ \t]+/
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
      if (lines.length === 0) break
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

function validAttributeLines(source: string, start: number, end: number, paragraphContext: boolean, heldContext?: ReturnType<typeof attributeContext>): boolean {
  const span = source.slice(start, end)
  let newline = span.indexOf('\n')
  if (newline < 0) return true
  const context = heldContext ?? attributeContext(source, start)
  if (context.indent === undefined) return true
  while (newline >= 0) {
    const next = span.indexOf('\n', newline + 1)
    const raw = span.slice(newline + 1, next >= 0 ? next : span.length)
    const line = attributeLine(raw, context.depth)
    const indent = line === undefined ? -1 : /^[ \t]*/.exec(line)![0].length
    if (indent < context.minimum || indent <= context.indent) return paragraphContext && continuesParagraph(source, start, context)
    newline = next
  }
  return true
}

const plainComment = /\{%[^%}]*(?:%[ \t\r]*)?\}/y

export function plainCommentEnd(source: string, start: number): number | undefined {
  plainComment.lastIndex = start
  const comment = plainComment.exec(source)?.[0]
  if (comment === undefined || /\n[ \t]*\r?\n/.test(comment)) return undefined
  if (comment.includes('>') && comment.includes('\n')) {
    const depth = attributeContext(source, start).depth
    if (depth > 0 && comment.split('\n').slice(1).some(raw => attributeLine(raw, depth)?.trim() === '')) return undefined
  }
  const end = start + comment.length
  return validAttributeLines(source, start, end, true) ? end : undefined
}

export type DjotAttributeToken = { key: string; source: string; append: boolean }

export function readAttributes(source: string, start: number, carve = false, table = false, paragraphContext = true, preserveShorthand = false): { end: number; source: string; tokens: DjotAttributeToken[] } | undefined {
  const parts: string[] = []
  const tokens: DjotAttributeToken[] = []
  let lastClassAssignment = -1
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
    if (source[i] === '}' && source.slice(start + 1, i).includes('\n') && !validAttributeLines(source, start, i + 1, paragraphContext && parts.length === 0, context)) return undefined
    if (source[i] === '}') {
      if (carve && table) {
        for (let at = start; at <= i; at++) {
          if (source[at] === '\\') at++
          else if (source[at] === '|') return undefined
        }
      }
      const nativeParts = carve && lastClassAssignment >= 0 ? parts.filter((_part, index) => index >= lastClassAssignment || tokens[index]!.key !== 'class') : parts
      return { end: i + 1, source: `{${nativeParts.join(' ')}}`, tokens }
    }
    if (source[i] === '%') {
      commentEnd.lastIndex = i + 1
      const end = commentEnd.exec(source)?.index ?? source.length
      const comment = source.slice(i, end)
      if (end === source.length || /\n[ \t]*\r?\n/.test(comment)) return undefined
      if (comment.includes('>') && comment.includes('\n')) {
        const depth = (context ??= attributeContext(source, start)).depth
        if (depth > 0 && comment.split('\n').slice(1, -1).some(raw => attributeLine(raw, depth)?.trim() === '')) return undefined
      }
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
      parts.push(preserveShorthand && !carve && kind === '.' || /^[A-Za-z0-9_][\w-]*$/.test(value) ? kind + value : `${kind === '#' ? 'id' : 'class'}=${quoteValue(value, carve)}`)
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
      if (key[0] === 'class=') lastClassAssignment = parts.length - 1
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
