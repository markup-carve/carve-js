import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import { attributedDjotWords } from '../src/djot-word-attributes.js'
import { djotPlaceholderPrefix } from '../src/djot-placeholder-prefix.js'

for (const base of ['\0DJOTSTRONG', '\0DJOTWORD', '\0DJOTORPHAN\0', '\0DJOTEMPTYTERM\0', '\0DJOTALT\0', '\0DJOTLITERAL\0']) {
  for (const mode of ['overlap', 'leading-zero', 'long-run', 'reserved-series']) {
    it(`preserves user ${base.replaceAll('\0', '')} placeholders: ${mode}`, () => {
      const token = mode === 'overlap' ? base + '0\0' + base.slice(1) + '1\0' : mode === 'leading-zero' ? base + '00\0' : mode === 'long-run' ? base + '\0'.repeat(32768) : Array.from({ length: 128 }, (_, n) => base + n + '\0').join('')
      expect(djotPlaceholderPrefix(token, base)).toBe(base + (mode === 'overlap' ? 2 : mode === 'reserved-series' ? 128 : 0) + '\0')
      const source = token + ' w{x}{.c} ![*alt*](u)\n\na {.o} b\n\n{.orphan}\n\n: ```\n  payload\n  ```\n\n{+unclosed\n'
      const converted = djotToCarve(source)
      expect(converted).toContain(source.startsWith('\0{.a}') ? '[\0]{.a}' + base + '\0' : token)
      expect(converted.replaceAll(token, '')).not.toContain('\0DJOT')
      const html = carveToHtml(converted)
      expect(html).toContain('class="c"')
      expect(html).toContain('alt="alt"')
      expect(html).toContain('<dd>')
      expect(html).toContain('a  b')
      expect(html).toContain('{+unclosed')
    })
  }
}

it('preserves placeholder text in frontmatter', () => {
  const prefix = '---\nlabel: \0DJOTSTRONG0\0\n---\n\n'
  const converted = djotToCarve(prefix + '\0DJOTSTRONG0\0 w{x}{.c}')
  expect(converted.startsWith(prefix)).toBe(true)
  expect(converted).toContain('\0DJOTSTRONG0\0')
  expect(carveToHtml(converted)).toContain('class="c"')
})

for (const index of [0, 7]) {
  it(`preserves attributed NULs before foreign markers: ${index}`, () => {
    const token = '[\0]{.a}DJOTSTRONG0\0' + index + '\0'
    expect(djotToCarve('\0{.a}DJOTSTRONG0\0' + index + '\0 w{.c}')).toBe(token + ' [w]{.c}')
  })
}

it('keeps user empty-term markers in image alt text', () => {
  const token = '\0DJOTEMPTYTERM\0' + '0\0'
  expect(djotToCarve(`![${token}](x)`)).toContain(token)
})

for (const base of ['DJOTSTRONG0', 'DJOTLITERAL\0' + '0', 'DJOTUSERNUL']) {
  it(`keeps user markers across flattened emphasis: ${base.replaceAll('\0', '')}`, () => {
    const source = '{*a \0{*' + base + '\0' + '0\0*} b*} w{.c}'
    const converted = djotToCarve(source)
    expect(converted).toContain('\0' + base + '\0' + '0\0')
    expect(carveToHtml(converted).match(/class="c"/g)).toHaveLength(1)
  })
}

it('keeps a long backslash run inside the attributed word', () => {
  const word = 'a' + '\\'.repeat(32768) + 'b'
  const source = word + '{.c}'
  expect(attributedDjotWords(source, source, text => text, text => text)).toBe(`[${word}]{.c}`)
})

it('preserves user text matching the NUL shield', () => {
  const token = '\0U\0'
  expect(djotToCarve(token + ' w{.c}')).toContain(token)
})

it('restores NUL characters in data carried by the importer', () => {
  for (const source of ['# a\0b', '[a](x\0y)', '![a](x\0y)', '[a]{key="x\0y"}', '<x:a\0b>']) {
    expect(djotToCarve(source)).toBe(source)
  }
})

it('restores original NUL bytes before flattening a formatted image label', () => {
  expect(djotToCarve('![*a*\0](x)')).toBe('![a\uFFFD](x)')
})

it('keeps an escaped NUL inside its attributed word', () => {
  expect(carveToHtml(djotToCarve('\\\0{.c}'))).toContain('<span class="c">')
})

for (const base of ['DJOTINVALIDATTR0', 'DJOTINVALIDATTR\0' + '0', 'DJOTNOTEATTR0', 'DJOTNOTEATTR\0' + '0']) {
  it(`preserves single-index user markers after syntax removal: ${base.replaceAll('\0', '')}`, () => {
    const token = '\0' + base + '\0'
    for (const source of ['\0{.a}' + base + '\0 {x y}', '{*a \0{*' + base + '\0*} b*} {x y}']) {
      const converted = djotToCarve(source + '\n\n[^n]: note\n\n  {.c}\n\n[^n]')
      expect(converted).toContain(source.startsWith('\0{.a}') ? '[\0]{.a}' + base + '\0' : token)
      expect(converted.replaceAll(token, '')).not.toContain('\0DJOT')
    }
  })
}

for (const word of ['\0', 'a\0', 'x\0y', '\0U\0', '\0\0']) {
  it(`keeps the whole attributed word with NULs: ${JSON.stringify(word)}`, () => {
    expect(djotToCarve(word + '{.a}')).toBe('[' + word + ']{.a}')
  })
}
