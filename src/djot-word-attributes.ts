import { nativeAttributeReader } from './djot-attributes.js'
import { djotPairedEmphasisOpeners } from './djot-emphasis.js'

export { readAttributes, nativeAttributeReader } from './djot-attributes.js'

export function attributedDjotWords(source: string, masked: string, convert: (body: string) => string, protect: (span: string) => string): string {
  if (!source.includes('{')) return source
  const paired = djotPairedEmphasisOpeners(source)
  let output = '', cursor = 0
  const readNative = nativeAttributeReader(source)
  const lastClose = source.lastIndexOf('}')
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
      attrs = { end: next.end, source: (attrs.source === '{}' ? '' : attrs.source) + (next.source === '{}' ? '' : next.source) || '{}' }
    }
    if (attrs.source === '{}') { i = attrs.end - 1; continue }
    let word = i
    if (i > 0 && masked[i - 1] === source[i - 1] && !/[`*_~^\]}>]/.test(source[i - 1]!)) {
      while (word > cursor && masked[word - 1] === source[word - 1] && !/[\s"'{}\[\]`\x00>|]/u.test(source[word - 1]!)) word--
      let pairedWord: number | undefined
      for (let at = i - 1; at >= word; at--) {
        if ((paired.get(at) ?? -1) > attrs.end) { pairedWord = at + 1; break }
      }
      if (pairedWord !== undefined) word = pairedWord
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
