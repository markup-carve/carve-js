import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'

const SEPARATORS = [' ', ' ']

describe('PART 11: a Unicode line separator is content, not a line end', () => {
  for (const sep of SEPARATORS) {
    const name = sep === ' ' ? 'U+2028' : 'U+2029'

    it(`${name} is a heading's content`, () => {
      expect(carveToHtml(`#  ${sep}\n`)).toContain('<h1>')
      expect(carveToHtml(`# a${sep}\n`)).toContain(`<h1>a${sep}</h1>`)
      expect(carveToHtml(`> # x ${sep}\n`)).toContain(`>x ${sep}</h1>`)
    })

    it(`${name} is a term's content`, () => {
      expect(carveToHtml(`:: ${sep}\n: d\n`)).toContain('<dl>')
      expect(carveToHtml(`:: t${sep}\n: d\n`)).toContain(`<dt>t${sep}</dt>`)
    })

    it(`${name} stays in a continuation row`, () => {
      const html = carveToHtml(`| a${sep} |\n+ b${sep} |\n`)
      expect(html).toContain(`<td>a${sep} b${sep}</td>`)
      expect(html).not.toContain('<p>')
    })

    it(`${name} stays in a task item's accessible name`, () => {
      expect(carveToHtml(`- [ ] outer${sep}\n  - inner\n`)).toContain(`aria-label="outer${sep}"`)
      expect(carveToHtml(`- [x] ${sep}a\n`)).toContain(`aria-label="${sep}a"`)
    })

    it(`${name} content survives the writer`, () => {
      for (const source of [`# a${sep}\n`, `:: t${sep}\n: d\n`, `| a${sep} |\n+ b${sep} |\n`]) {
        const written = renderCarve(parse(source))
        expect(carveToHtml(written)).toBe(carveToHtml(source))
      }
    })
  }

  it('keeps no-break and other Unicode spaces in a task name', () => {
    expect(carveToHtml('- [ ] a \n')).toContain('aria-label="a "')
    expect(carveToHtml('- [ ] a \n')).toContain('aria-label="a "')
    expect(carveToHtml('- [ ] a﻿\n')).toContain('aria-label="a﻿"')
  })

  it('still trims the space that collapses ASCII whitespace in a task name', () => {
    expect(carveToHtml('- [ ] a\n  b\n')).toContain('aria-label="a b"')
  })
})
