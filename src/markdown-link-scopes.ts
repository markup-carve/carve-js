import { markdownEmphasis } from './markdown-emphasis.js'

export function protectMarkdownLinkLabels(
  source: string,
  spans: readonly string[],
  protect: (value: string) => string,
  isReference: (label: string) => boolean,
  onFlatten: () => void = () => {},
): string {
  const output: string[] = []
  const opens: { slot: number; generation: number }[] = []
  let generation = 0
  let flattened = false
  const tokenAt = /\x00P(\d+)\x00/y
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (char === '\x00') {
      tokenAt.lastIndex = i
      const token = tokenAt.exec(source)
      if (token) { output.push(token[0]); i += token[0].length - 1; continue }
    }
    if (char === '\\' && i + 1 < source.length) {
      output.push(source.slice(i, i + 2)); i++; continue
    }
    if (char === '[') opens.push({ slot: output.length, generation })
    if (char === ']' && opens.length) {
      const opener = opens.pop()!
      tokenAt.lastIndex = i + 1
      const token = tokenAt.exec(source)
      const tail = token ? spans[Number(token[1])] ?? '' : ''
      const reference = /^\[([^\]]*)\]$/.exec(tail)
      const active = opener.generation === generation
      const needsLabel = active && token !== null && (tail.startsWith('(') || reference !== null)
      const label = needsLabel ? output.slice(opener.slot + 1).join('') : ''
      const valid = tail.startsWith('(') || reference !== null && isReference(reference[1] || label)
      if (valid && token) {
        if (active) {
          output.splice(opener.slot, output.length - opener.slot,
            '[', markdownEmphasis(label, () => { flattened = true }, undefined, spans).replace(/[*_]/g, char => protect(char)), ']', token[0])
          generation++
        } else return source
        i += token[0].length
        continue
      }
    }
    output.push(char)
  }
  if (flattened) onFlatten()
  return output.join('')
}

export function escapeInactiveMarkdownLinkBrackets(
  source: string,
  protect: (value: string) => string,
  isReference: (label: string) => boolean,
  opaqueEnd: (offset: number) => number | undefined,
  onActiveLink: (opener: number, closer: number) => void = () => {},
): string {
  const opaque = new Map<number, number>()
  const parens = new Map<number, number>()
  const parenStack: number[] = []
  const brackets = new Map<number, number>()
  const bracketStack: number[] = []
  const nestedBrackets = new Set<number>()
  const tokenAt = /\x00P\d+\x00/y
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\x00') {
      tokenAt.lastIndex = i
      const token = tokenAt.exec(source)
      if (token) { i += token[0].length - 1; continue }
    }
    if (source[i] === '<') {
      const end = opaqueEnd(i)
      if (end !== undefined) { opaque.set(i, end); i = end - 1; continue }
    }
    if (source[i] === '\\') { i++; continue }
    if (parenStack.length && source[parenStack.at(-1)! - 1] === ']' && (source[i] === '"' || source[i] === "'") && /[ \t\n]/.test(source[i - 1] ?? '')) {
      const quote = source[i]!
      let end = i + 1
      for (; end < source.length; end++) {
        if (source[end] === '\\') end++
        else if (source[end] === quote) break
      }
      let after = end + 1
      while (/[ \t\n]/.test(source[after] ?? '')) after++
      if (end < source.length && source[after] === ')') { i = end; continue }
    }
    if (source[i] === '[') {
      if (bracketStack.length) nestedBrackets.add(bracketStack.at(-1)!)
      bracketStack.push(i)
    } else if (source[i] === ']' && bracketStack.length) brackets.set(bracketStack.pop()!, i)
    if (source[i] === '(') parenStack.push(i)
    else if (source[i] === ')' && parenStack.length) parens.set(parenStack.pop()!, i)
  }
  const opens: { at: number; image: boolean; generation: number }[] = []
  const escaped = new Set<number>()
  let generation = 0
  let escapedTailThrough = -1
  let escapedPosition = -1
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\x00') {
      tokenAt.lastIndex = i
      const token = tokenAt.exec(source)
      if (token) { i += token[0].length - 1; continue }
    }
    const opaqueThrough = opaque.get(i)
    if (opaqueThrough !== undefined) { i = opaqueThrough - 1; continue }
    if (source[i] === '\\') { escapedPosition = i + 1; i++; continue }
    if (source[i] === '[') {
      opens.push({ at: i, image: source[i - 1] === '!' && escapedPosition !== i - 1, generation })
      continue
    }
    if (source[i] !== ']' || opens.length === 0) continue
    const opener = opens.pop()!
    if (!opener.image && opener.generation !== generation) {
      escaped.add(opener.at)
      escaped.add(i)
      const tailEnd = parens.get(i + 1)
      if (tailEnd !== undefined) {
        for (let at = Math.max(i + 2, escapedTailThrough + 1); at < tailEnd; at++) {
          const end = opaque.get(at)
          if (end !== undefined) at = end - 1
          else if (source[at] === '/') escaped.add(at)
        }
        escapedTailThrough = Math.max(escapedTailThrough, tailEnd)
      }
      continue
    }
    const end = activationTailEnd(source, i + 1)
    if (end !== undefined) {
      onActiveLink(opener.at, i)
      if (!opener.image) generation++
      i = end
      continue
    }
    let label = nestedBrackets.has(opener.at) ? null : source.slice(opener.at + 1, i)
    let referenceEnd = i
    const close = brackets.get(i + 1)
    if (close !== undefined && !nestedBrackets.has(i + 1)) {
      label = source.slice(i + 2, close) || label
      referenceEnd = close
    }
    if (label !== null && isReference(label)) {
      onActiveLink(opener.at, i)
      if (!opener.image) generation++
      i = referenceEnd
    }
  }
  const output: string[] = []
  for (let i = 0; i < source.length; i++) output.push(escaped.has(i) ? protect(`\\${source[i]!}`) : source[i]!)
  return output.join('')
}

function activationTailEnd(source: string, open: number): number | undefined {
  if (source[open] !== '(') return undefined
  let at = open + 1
  const tokenAt = /\x00P\d+\x00/y
  const skipSpace = (): boolean => {
    const begin = at
    while (/[ \t\n]/.test(source[at] ?? '')) at++
    return at > begin
  }
  skipSpace()
  if (source[at] === '<') {
    for (at++; at < source.length && source[at] !== '>'; at++) {
      if (source[at] === '\\') at++
      else if (source[at] === '<' || source[at] === '\n') return undefined
    }
    if (source[at] !== '>') return undefined
    at++
  } else {
    let depth = 0
    for (; at < source.length; at++) {
      if (source[at] === '\x00') {
        tokenAt.lastIndex = at
        const token = tokenAt.exec(source)
        if (token) { at += token[0].length - 1; continue }
      }
      if (source[at] === '\\') { at++; continue }
      if (source[at] === '(') {
        if (++depth > 32) return undefined
      } else if (source[at] === ')') {
        if (depth === 0) break
        depth--
      } else if (/[\x00-\x20\x7f]/.test(source[at]!)) {
        if (depth > 0) return undefined
        break
      }
    }
    if (depth > 0) return undefined
  }
  const spaced = skipSpace()
  if (source[at] === ')') return at
  if (!spaced || !['"', "'", '('].includes(source[at] ?? '')) return undefined
  const close = source[at] === '(' ? ')' : source[at]!
  const begin = ++at
  for (; at < source.length && source[at] !== close; at++) {
    if (source[at] === '\\') at++
    else if (close === ')' && source[at] === '(') return undefined
    else if (source[at] === '\n' && /^[ \t]*\n/.test(source.slice(at + 1))) return undefined
  }
  if (at >= source.length || at < begin) return undefined
  at++
  skipSpace()
  return source[at] === ')' ? at : undefined
}
