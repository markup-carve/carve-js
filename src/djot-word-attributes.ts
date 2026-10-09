import { nativeAttributeReader } from './djot-attributes.js'
import { djotPairedEmphasisOpeners } from './djot-emphasis.js'

export { readAttributes, nativeAttributeReader } from './djot-attributes.js'

export function attributedDjotWords(source: string, masked: string, convert: (body: string) => string, protect: (span: string) => string): string {
  if (!source.includes('{')) return source
  const paired = djotPairedEmphasisOpeners(source)
  const literalBraces = new Map<number, number>()
  const escapedBraceCloses = new Set<number>()
  for (const note of source.matchAll(/\[\^[^\]\n]*\]/g)) {
    const at = note.index!
    let begin = at
    while (begin > 0 && source[begin - 1] === '\\') begin--
    let closeBegin = at + note[0].length - 1
    while (closeBegin > at && source[closeBegin - 1] === '\\') closeBegin--
    if ((at - begin) % 2 && (at + note[0].length - 1 - closeBegin) % 2 === 0 && /^[^\s{}*_~`\\]+$/u.test(note[0])) {
      literalBraces.set(at + note[0].length - 1, at - 1)
      escapedBraceCloses.add(at + note[0].length - 1)
    }
  }
  const braceStack: Array<{ begin: number; literal: boolean; spaces: number }> = []
  let spaces = 0
  for (let at = 0; at < source.length; at++) {
    if (/\s/u.test(source[at]!)) spaces++
    if (source[at] === '\\') {
      if (source[at + 1] === '{' && masked[at + 1] === '{') braceStack.push({ begin: at, literal: true, spaces })
      else if (source[at + 1] === '}' || source[at + 1] === ']') {
        if (source[at + 1] === '}' && braceStack.at(-1)?.literal) braceStack.pop()
        literalBraces.set(at + 1, at); escapedBraceCloses.add(at + 1)
      }
      at++
      continue
    }
    if (masked[at] !== source[at]) continue
    if (source[at] === '{') braceStack.push({ begin: at, literal: false, spaces })
    else if (source[at] === '}') {
      const open = braceStack.pop()
      if (open?.literal && open.spaces === spaces) literalBraces.set(at, open.begin)
    }
  }
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
    if (i > 0 && masked[i - 1] === source[i - 1] && (!/[`*_~^\]}>]/.test(source[i - 1]!) || literalBraces.has(i - 1))) {
      while (word > cursor && masked[word - 1] === source[word - 1]) {
        const literal = literalBraces.get(word - 1)
        if (literal !== undefined && literal >= cursor) { const escaped = escapedBraceCloses.has(word - 1); word = literal; if (escaped) break; continue }
        if (/[\s"'{}\[\]`\x00>|]/u.test(source[word - 1]!)) break
        word--
      }
      let pairedWord: number | undefined
      for (let at = i - 1; at >= word; at--) {
        if ((paired.get(at) ?? -1) > attrs.end) { pairedWord = at + 1; break }
      }
      if (pairedWord !== undefined) word = pairedWord
      if (word > 0 && source[word - 1] === '{' && /[+\-=]/.test(source[word] ?? '')) word++
    }
    if (word < i) {
      let body = convert('x ' + source.slice(word, i)).slice(2).replace(/^\^/, '\\^')
      if (source[i - 1] === ']' && escapedBraceCloses.has(i - 1) && literalBraces.get(i - 1) !== i - 2) body = body.slice(0, -1) + '\\]'
      output += source.slice(cursor, word) + protect(`${source[word - 1] === ']' ? '{%%}' : ''}[${body}]${attrs.source}`)
      cursor = attrs.end
    }
    i = attrs.end - 1
  }
  return output + source.slice(cursor)
}
