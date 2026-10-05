import { expect, it } from 'vitest'
import { SubstitutionScanner } from '../src/substitution-scanner.js'

function reference(text: string, from: number, to: number): number {
  for (let at = from; at < to; at++) {
    const ch = text[at]
    if (ch === '\\') at++
    else if (ch === '`') {
      let width = 1
      while (text[at + width] === '`') width++
      let end = at + width
      let closed = false
      while (end < text.length) {
        if (text[end] !== '`') { end++; continue }
        let run = 1
        while (text[end + run] === '`') run++
        end += run
        if (run === width) { closed = true; break }
      }
      if (!closed) return -1
      at = end - 1
    } else if (ch === '{' && (text[at + 1] === '%' || text[at + 1] === '#')) {
      const close = text.indexOf(`${text[at + 1]}}`, at + 2)
      if (close !== -1 && close < to) at = close + 1
    } else if (ch === '~' && text[at + 1] === '>') return at
  }
  return -1
}

it('matches the original scanner for varying limits inside opaque spans', () => {
  const sources = ['{#}~>x#}', '{%}~>x%}', '{%~>x%}~>z', '{%{#~>x#}%}~>', '`~>`~>', '\\~>~>', '```~>``~>']
  const tokens = ['x', '~>', '{%', '{#', '%}', '#}', '`', '``', '\\', '{~', '~}']
  let seed = 19
  for (let sample = 0; sample < 120; sample++) {
    let source = ''
    for (let token = 0; token < 15; token++) {
      seed = Math.imul(seed, 1664525) + 1013904223 | 0
      source += tokens[(seed >>> 0) % tokens.length]
    }
    sources.push(source)
  }
  for (const source of sources) {
    const scanner = new SubstitutionScanner(source)
    for (let from = 0; from < source.length; from++) {
      for (let to = from; to <= source.length; to++) {
        expect(new SubstitutionScanner(source).findArrow(from, to), `${source}: first ${from}..${to}`).toBe(reference(source, from, to))
        expect(scanner.findArrow(from, to), `${source}: ${from}..${to}`).toBe(reference(source, from, to))
      }
    }
  }
})
