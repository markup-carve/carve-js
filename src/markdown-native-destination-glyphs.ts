import { backtickRunEnds } from './backtick-run-index.js'
import { markdownInlineDestinationEnd } from './markdown-link-scopes.js'

export function protectNativeMarkdownDestinationGlyphs(
  source: string,
  protect: (value: string) => string,
  isReference: (label: string) => boolean,
  opaqueEnd: (offset: number) => number | undefined,
): string {
  const codeEnds = backtickRunEnds(source)
  const opens: Array<{ at: number; image: boolean; generation: number; nested: boolean }> = []
  const glyphs = new Map<number, number>()
  const tokenAt = /\x00P\d+\x00/y
  let generation = 0
  for (let at = 0; at < source.length; at++) {
    if (source[at] === '\x00') {
      tokenAt.lastIndex = at
      const token = tokenAt.exec(source)
      if (token) { at += token[0].length - 1; continue }
    }
    if (source[at] === '\\' && /[!-/:-@\[-`{-~]/.test(source[at + 1] ?? '')) { at++; continue }
    if (source[at] === '`') {
      const end = codeEnds?.[at] ?? -1
      if (end >= 0) { at = end - 1; continue }
      while (source[at + 1] === '`') at++
      continue
    }
    if (source[at] === '<' || source[at] === '$') {
      const end = opaqueEnd(at)
      if (end !== undefined) { at = end - 1; continue }
    }
    if (source[at] === '[') {
      if (opens.length) opens.at(-1)!.nested = true
      let before = at - 1
      while (source[before - 1] === '\\') before--
      opens.push({ at, image: source[at - 1] === '!' && (at - 1 - before) % 2 === 0, generation, nested: false })
      continue
    }
    if (source[at] !== ']' || opens.length === 0) continue
    const opener = opens.pop()!
    if (!opener.image && opener.generation !== generation) continue
    const open = at + 1
    const end = markdownInlineDestinationEnd(source, open)
    if (end !== undefined) {
      let first = open + 1
      while (/[ \t\n]/.test(source[first] ?? '')) first++
      if (source[first] === '<' && first + 1 < end && source[first + 1] !== '>') {
        const escaped = source[first + 1] === '\\' && /[!-/:-@\[-`{-~]/.test(source[first + 2] ?? '')
        glyphs.set(first + 1, escaped ? 2 : 1)
      }
      for (let pos = open + 1; pos < end; pos++) {
        if (source[pos] === '`' || source[pos] === '$' || source[pos] === '<' && pos !== first) glyphs.set(pos, 1)
      }
      if (!opener.image) generation++
      at = end
      continue
    }
    let label: string | undefined = opener.nested ? undefined : source.slice(opener.at + 1, at)
    let referenceEnd = at
    if (source[open] === '[') {
      let close = open + 1
      for (; close < source.length; close++) {
        if (source[close] === '\\' && /[!-/:-@\[-`{-~]/.test(source[close + 1] ?? '')) close++
        else if (source[close] === '[' || source[close] === ']') break
      }
      if (source[close] === ']' && !/\n[ \t]*\n/.test(source.slice(open + 1, close))) {
        label = source.slice(open + 1, close) || label
        referenceEnd = close
      }
    }
    if (label !== undefined && isReference(label)) {
      if (!opener.image) generation++
      at = referenceEnd
    }
  }
  if (glyphs.size === 0) return source
  const output: string[] = []
  for (let at = 0; at < source.length; at++) {
    const width = glyphs.get(at)
    if (width) {
      output.push(protect(source.slice(at, at + width)))
      at += width - 1
    } else output.push(source[at]!)
  }
  return output.join('')
}
