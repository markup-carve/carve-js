import { djotStructuralPrefixEnd } from './djot-structural-prefix.js'

const quoteValue = (value: string, carve = false): string => `"${value.replace(carve ? /[!-\/:-@\[-`{-~]/g : /[\\"]/g, char => '\\' + char)}"`

function attributeContext(source: string, start: number): { depth: number; indent: number | undefined; minimum: number } {
  let prefix = source.slice(source.lastIndexOf('\n', start - 1) + 1, start), depth = 0
  while (true) { const quote = /^[ \t]*>(?:[ \t]|$)/.exec(prefix); if (!quote) break; prefix = prefix.slice(quote[0].length); depth++ }
  const marker = /^[ \t]*(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+/.exec(prefix)
  return { depth, indent: /^(?:[ \t]*(?:[-*+]|[0-9A-Za-z]+[.)]|\([0-9A-Za-z]+\))[ \t]+)?[ \t]*$/.test(prefix) ? prefix.length : undefined, minimum: marker?.[0].length ?? 0 }
}
function attributeLine(line: string, depth: number): string | undefined {
  for (let n = 0; n < depth; n++) { const quote = /^[ \t]*>(?:[ \t]|$)/.exec(line); if (!quote) return undefined; line = line.slice(quote[0].length) }
  return line
}

export function readAttributes(source: string, start: number, carve = false, table = false): { end: number; source: string } | undefined {
  const parts: string[] = []
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
    if (source[i] === '}' && parts.length && source.slice(start, i + 1).includes('\n')) {
      const context = attributeContext(source, start)
      for (const raw of source.slice(start, i + 1).split('\n').slice(1)) {
        const line = attributeLine(raw, context.depth)
        if (context.indent !== undefined && line === undefined) return undefined
        const indent = /^[ \t]*/.exec(line ?? raw)![0].length
        if (context.indent !== undefined && (indent < context.minimum || indent <= context.indent)) return undefined
      }
    }
    if (source[i] === '}') {
      if (carve && table) {
        for (let at = start; at <= i; at++) {
          if (source[at] === '\\') at++
          else if (source[at] === '|') return undefined
        }
      }
      return parts.length ? { end: i + 1, source: `{${parts.join(' ')}}` } : undefined
    }
    if (source[i] === '%') {
      let end = i + 1
      while (end < source.length && source[end] !== '%' && source[end] !== '}') end++
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
    } else {
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
        while (i < source.length && !/[\s{}%"'=<>]/u.test(source[i]!)) i++
        if (i === from) return undefined
        parts.push(key[0] + quoteValue(source.slice(from, i), carve))
      }
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

export function attributedDjotWords(source: string, masked: string, convert: (body: string) => string, protect: (span: string) => string): string {
  let output = '', cursor = 0
  const readNative = nativeAttributeReader(source)
  const lastClose = source.lastIndexOf('}')
  const lastDelimiters = Object.fromEntries([..."_*~^"].map(marker => [marker, source.lastIndexOf(marker)]))
  for (let i = 0; i <= lastClose; i++) {
    if (source[i] !== '{' || masked[i] !== '{') continue
    let slashes = 0
    for (let at = i - 1; at >= 0 && source[at] === '\\'; at--) slashes++
    if (slashes % 2) continue
    let attrs = readNative(i)
    if (!attrs) continue
    while (source[attrs.end] === '{') {
      const next = readNative(attrs.end)
      if (!next) break
      attrs = { end: next.end, source: attrs.source + next.source }
    }
    let word = i
    if (i > 0 && masked[i - 1] === source[i - 1] && !/[`*_~^\]}>]/.test(source[i - 1]!)) {
      while (word > cursor && masked[word - 1] === source[word - 1] && !/[\s"'{}\[\]`\x00>|]/u.test(source[word - 1]!)) word--
      const closer = source[attrs.end] ?? ''
      if (closer && '_*~^'.includes(closer)) {
        for (let opener = i - 1; opener >= word; opener--) {
          if (source[opener] !== closer) continue
          let escapes = 0
          for (let at = opener - 1; at >= 0 && source[at] === '\\'; at--) escapes++
          if (escapes % 2 === 0) { word = opener + 1; break }
        }
      } else if (word < i && /[_*~^]/.test(source[word]!) && lastDelimiters[source[word]!]! >= attrs.end) word++
      if (word > 0 && source[word - 1] === '{' && /[+\-=]/.test(source[word] ?? '')) word++
    }
    if (word < i) {
      const body = convert('x ' + source.slice(word, i)).slice(2).replace(/^\^/, '\\^')
      output += source.slice(cursor, word) + protect(`[${body}]${attrs.source}`)
      cursor = attrs.end
    }
    i = attrs.end - 1
  }
  return output + source.slice(cursor)
}
