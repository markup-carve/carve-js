const quoteValue = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function readAttributes(source: string, start: number): { end: number; source: string } | undefined {
  const parts: string[] = []
  let i = start + 1
  while (i < source.length) {
    while (/[ \t\n\r]/.test(source[i] ?? '') && i < source.length) {
      if (source[i] === '\n' && /^[ \t]*\n/.test(source.slice(i + 1))) return undefined
      i++
    }
    if (source[i] === '}') return parts.length ? { end: i + 1, source: `{${parts.join(' ')}}` } : undefined
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
      while (i < source.length && !/[\s{}%"'=<>]/u.test(source[i]!)) i++
      if (i === from) return undefined
      const value = source.slice(from, i)
      parts.push(/^[A-Za-z0-9_][\w-]*$/.test(value) ? kind + value : `${kind === '#' ? 'id' : 'class'}=${quoteValue(value)}`)
    } else {
      const key = /^[A-Za-z_][A-Za-z0-9_-]*=/.exec(source.slice(i))
      if (!key) return undefined
      i += key[0].length
      const from = i
      if (source[i] === '"') {
        i++
        while (i < source.length && source[i] !== '"') {
          if (source[i] === '\n' || source[i] === '\r') return undefined
          if (source[i] === '\\') i++
          i++
        }
        if (source[i] !== '"') return undefined
        i++
        parts.push(key[0] + source.slice(from, i))
      } else {
        while (i < source.length && !/[\s{}%"'=<>]/u.test(source[i]!)) i++
        if (i === from) return undefined
        parts.push(key[0] + quoteValue(source.slice(from, i)))
      }
    }
    if (i < source.length && !/[\s}%]/u.test(source[i]!)) return undefined
  }
  return undefined
}

export function attributedDjotWords(source: string, masked: string, convert: (body: string) => string, protect: (span: string) => string): string {
  let output = '', cursor = 0
  const lastClose = source.lastIndexOf('}')
  const lastDelimiters = Object.fromEntries([..."_*~^"].map(marker => [marker, source.lastIndexOf(marker)]))
  for (let i = 0; i <= lastClose; i++) {
    if (source[i] !== '{' || masked[i] !== '{') continue
    let slashes = 0
    for (let at = i - 1; at >= 0 && source[at] === '\\'; at--) slashes++
    if (slashes % 2) continue
    const attrs = readAttributes(source, i)
    if (!attrs) continue
    let word = i
    if (i > 0 && masked[i - 1] === source[i - 1] && !/[`*_~^\]}>]/.test(source[i - 1]!)) {
      while (word > cursor && masked[word - 1] === source[word - 1] && !/[\s"'{}\[\]`\x00)>]/u.test(source[word - 1]!)) word--
      if (word < i && /[_*~^]/.test(source[word]!)) {
        if (source[attrs.end] === source[word]) word++
        else if (lastDelimiters[source[word]!]! >= attrs.end) word = i
      }
      if (word > 0 && source[word - 1] === '{' && /[+\-=]/.test(source[word] ?? '')) word++
    }
    if (word < i) {
      output += source.slice(cursor, word) + protect(`[${convert('x ' + source.slice(word, i)).slice(2)}]${attrs.source}`)
      cursor = attrs.end
    }
    i = attrs.end - 1
  }
  return output + source.slice(cursor)
}
