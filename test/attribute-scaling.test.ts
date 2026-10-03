import { describe, expect, it } from 'vitest'
import { parseAttrs } from '../src/attribute-parser.js'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

describe('attribute parsing work', () => {
  it('preserves class duplicates, key overrides, prototype keys and first-seen order', () => {
    const attrs = parseAttrs('.a class=b class .a __proto__=first title=one title=two __proto__=last :en lang=de')
    expect(attrs.classes).toEqual(['a', 'b', '', 'a'])
    expect(attrs.keyValues).toEqual({ ['__proto__']: 'last', title: 'two', lang: 'de' })
    expect(Object.getPrototypeOf(attrs.keyValues)).toBe(Object.prototype)
    expect(attrs.order).toEqual(['.class', '__proto__', 'title', 'lang'])
  })

  it('stores prototype keys when adjacent attribute blocks are combined', () => {
    const html = carveToHtml('{__proto__=first}{.a}{__proto__=last}\npara\n')
    expect(html).toBe('<p __proto__="last" class="a">para</p>')
  })

  it('keeps a valid wrapped block after malformed attribute openers', () => {
    const html = carveToHtml('{abcd\n{abcd\n\n{#valid\n.class}\ntext\n')
    expect(html).toContain('<p>{abcd\n{abcd</p>')
    expect(html).toContain('<p id="valid" class="class">text</p>')
  })

  it('keeps valid three-line attributes after a rejected opener inside containers', () => {
    for (const source of [
      '{abcd\n{#valid\n  .class\nrole=note}\ntext\n',
      '> {abcd\n> {#valid\n>   .class\n> role=note}\n> text\n',
      '- {abcd\n  {#valid\n    .class\n  role=note}\n  text\n',
    ]) {
      const html = carveToHtml(source)
      expect(html).toContain('id="valid" class="class" role="note"')
      expect(html).toContain('{abcd')
    }
  })

  it('keeps quoted values that cross a newline as literal paragraph content', () => {
    for (const source of ['{key="a\nb"}\npara\n', '{key="a\nb c\nd"}\npara\n']) {
      const html = carveToHtml(source)
      expect(html).not.toContain('<p key=')
      expect(html).toContain('{key=')
    }
  })

  for (const suffix of ['', '}\n', '\n}\n']) {
    perfIt(`bounds repeated wrapped openers before ${JSON.stringify(suffix)}`, () => {
      expectScansLinearly((input) => void carveToHtml(input), '{abcd\n', {
        suffix, label: 'malformed wrapped attribute openers', smallRepeats: 4000,
      })
    })
  }

  perfIt('appends a long class payload in linear time', () => {
    expectScansLinearly((input) => void parseAttrs(input), '.a ', {
      label: 'attribute classes', smallRepeats: 8000,
    })
  })

  perfIt('stores distinct attribute keys and their order in linear time', () => {
    const inputs = new Map([2000, 8000].map(n => [n, Array.from({ length: n }, (_, i) => `key${i}=value`).join(' ')]))
    expectScansLinearly(input => void parseAttrs(inputs.get(input.length)!), 'x', {
      label: 'distinct attribute keys', smallRepeats: 2000,
    })
  })
})
