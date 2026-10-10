import { nativeAttributeReader } from './djot-attributes.js'
import { djotPairedEmphasisOpeners } from './djot-emphasis.js'

export { readAttributes, nativeAttributeReader } from './djot-attributes.js'

export function attributedDjotWords(source: string, masked: string, convert: (body: string) => string, protect: (span: string) => string, inherited: ReadonlySet<string> = new Set()): string {
  if (!source.includes('{')) return source
  const paired = djotPairedEmphasisOpeners(source)
  const literalBraces = new Map<number, number>()
  const pairedCloses = new Set(paired.values())
  const escapedBraceCloses = new Set<number>()
  const escapedWordCharacters = new Map<number, number>()
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
  const braceStack: Array<{ begin: number; literal: boolean; space: number }> = []
  const readBraceAttributes = nativeAttributeReader(source)
  let attributeEnd = 0
  let lastEscaped = -1, lastAtomEscape = -1, lastSpace = -1, lastInlineEnd = -1
  const inheritedMarker = /\0DJOTINVALIDATTR\x00\d+\0/y
  for (let at = 0; at < source.length; at++) {
    if (/\s/u.test(source[at]!)) lastSpace = at
    if (pairedCloses.has(at)) lastInlineEnd = at
    if (source[at] === '\\') {
      if (source[at + 1] !== undefined && !/\s/u.test(source[at + 1]!)) escapedWordCharacters.set(source.slice(at + 1, at + 4) === '\0U\0' ? at + 4 : at + 2, at)
      if (masked[at] !== source[at] || masked[at + 1] !== source[at + 1]) { lastInlineEnd = at + 2; at++; continue }
      lastEscaped = at + 1
      if (/\s/u.test(source[at + 1] ?? '')) lastSpace = at + 1
      inheritedMarker.lastIndex = at + 2
      const marker = inherited.size ? inheritedMarker.exec(source)?.[0] : undefined
      const generated = marker !== undefined && inherited.has(marker)
      if (generated) literalBraces.set(at + 1 + marker.length, at + 2)
      if (!generated && /[!-\/:-@\[-`{-~]/.test(source[at + 1] ?? '')) lastAtomEscape = at
      if (source[at + 1] === '{' && masked[at + 1] === '{') braceStack.push({ begin: at, literal: true, space: lastSpace })
      else if (source[at + 1] === '}' || source[at + 1] === ']') {
        if (source[at + 1] === '}' && braceStack.at(-1)?.literal) braceStack.pop()
        literalBraces.set(at + 1, at); escapedBraceCloses.add(at + 1)
      }
      at++
      continue
    }
    if (masked[at] !== source[at]) { lastInlineEnd = at + 1; continue }
    if (source[at] === '{' && at >= attributeEnd) attributeEnd = readBraceAttributes(at)?.end ?? at
    if (at >= attributeEnd && source[at] === '}' && '+-=~^*_'.includes(source[at - 1] ?? '\0') && !pairedCloses.has(at + 1)) {
      literalBraces.set(at, at - 1 === lastEscaped ? at - 2 : at - 1)
      if (at - 1 === lastEscaped) escapedBraceCloses.add(at)
    }
    if (source[at] === '{') braceStack.push({ begin: at, literal: at >= attributeEnd && /[.#% \tA-Za-z]/.test(source[at + 1] ?? ''), space: lastSpace })
    else if (source[at] === '}') {
      const open = braceStack.pop()
      if (open?.literal && !escapedBraceCloses.has(at)) {
        const from = Math.max(lastAtomEscape, lastInlineEnd)
        if (from >= open.begin && from > lastSpace) {
          literalBraces.set(at, from)
          escapedBraceCloses.add(at)
        } else literalBraces.set(at, lastSpace === open.space ? open.begin : at)
      }
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
      attrs = { tokens: [...attrs.tokens, ...next.tokens], end: next.end, source: (attrs.source === '{}' ? '' : attrs.source) + (next.source === '{}' ? '' : next.source) || '{}' }
    }
    if (attrs.source === '{}') { i = attrs.end - 1; continue }
    let word = i
    if (i > 0 && masked[i - 1] === source[i - 1] && (!/[`*_~^\]}>]/.test(source[i - 1]!) || literalBraces.has(i - 1) || escapedWordCharacters.has(i))) {
      while (word > cursor && masked[word - 1] === source[word - 1]) {
        const literal = literalBraces.get(word - 1)
        if (literal !== undefined && literal >= cursor) { word = literal; continue }
        const escaped = escapedWordCharacters.get(word)
        if (escaped !== undefined && escaped >= cursor) { word = escaped; continue }
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
      output += source.slice(cursor, word) + protect(`${source[word - 1] === ']' || source[word - 1] === '^' || source[word - 1] === '!' ? '{%%}' : ''}[${body}]${attrs.source}`)
      cursor = attrs.end
    }
    i = attrs.end - 1
  }
  return output + source.slice(cursor)
}
