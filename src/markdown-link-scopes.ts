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
