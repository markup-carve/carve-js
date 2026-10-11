import { describe, expect, it } from 'vitest'
import { parse, carveToHtml, type CarveExtension } from '../src/index.js'

const fallback: CarveExtension = { name: 'word-fallback', matchInline: () => null }

describe('short inline words preserve parser behavior', () => {
  const words = ['x', 'HTML', 'a'.repeat(64), 'a'.repeat(65), 'é', 'a b', 'a\\*b']
  for (const word of words) {
    for (const marker of ['*', '/', '_', '-', '+', '^', '~', '=']) {
      for (const source of [
        `${marker}${word}${marker}`,
        `{${marker}${word}${marker}}{k="*}"}`,
        `😀 prefix {${marker}${word}${marker}} suffix`,
        `> - {${marker}${word}${marker}}\n`,
        `*[HTML]: HyperText Markup Language\n\n{${marker}${word}${marker}}`,
      ]) {
        it(`matches the general parser for ${JSON.stringify(source)}`, () => {
          expect(parse(source)).toEqual(parse(source, { extensions: [fallback] }))
          expect(parse(source, { positions: false })).toEqual(parse(source, { positions: false, extensions: [fallback] }))
        })
      }
    }
  }

  it('allows extensions to claim words inside emphasis', () => {
    const extension: CarveExtension = {
      name: 'word-link',
      matchInline(text, pos) {
        if (!text.startsWith('alpha', pos)) return null
        return { node: { type: 'link', href: '#alpha', children: [{ type: 'text', value: 'alpha' }] }, end: pos + 5 }
      },
    }
    expect(carveToHtml('*alpha* {*alpha*}', { extensions: [extension] })).toBe(
      '<p><strong><a href="#alpha">alpha</a></strong> <strong><a href="#alpha">alpha</a></strong></p>',
    )
  })
})
