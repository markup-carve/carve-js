import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// CARVE-P3-025 (markup-carve/carve#3209): a delimiter followed by a combining
// mark, a variation selector or U+200D is part of a larger character.
const KEYCAP = '*️⃣'
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a delimiter that is part of a larger character is text', () => {
  it.each([
    [`${KEYCAP}abc*`, `<p>${KEYCAP}abc*</p>`],
    [`*a${KEYCAP}`, `<p>*a${KEYCAP}</p>`],
    ['*a*́ b*', '<p><strong>a*́ b</strong></p>'],
    ['_︎x _y_', '<p>_︎x <u>y</u></p>'],
    ['~a~‍b~', '<p><s>a~‍b</s></p>'],
    ['=x=‍', '<p>=x=‍</p>'],
    ['/x/⃝', '<p>/x/⃝</p>'],
    ['*a*\u{E0100}', '<p>*a*\u{E0100}</p>'],
    [`*x* ${KEYCAP} *y*`, `<p><strong>x</strong> ${KEYCAP} <strong>y</strong></p>`],
  ])('%s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('applies to a forced opener of the five bare delimiters', () => {
    expect(html(`{${KEYCAP}abc*}`)).toBe(`<p>{${KEYCAP}abc*}</p>`)
    expect(html('{/️x/}')).toBe('<p>{/️x/}</p>')
    expect(html('{*a {*́b*} c*}')).toBe('<p><strong>a {*́b</strong> c*}</p>')
  })

  it('leaves the braced-only superscript and subscript openers alone', () => {
    expect(html('{^️a^}')).toBe('<p><sup>️a</sup></p>')
    expect(html('{,́a,}')).toBe('<p><sub>́a</sub></p>')
  })

  it('applies to both halves of the combined token', () => {
    expect(html('/*️a*/')).toBe('<p><em>*️a*</em></p>')
    expect(html('/*a*/️')).toBe('<p>/<strong>a</strong>/️</p>')
  })

  it('writes source that reads back the same tree', () => {
    for (const source of [`${KEYCAP}abc*`, `*a${KEYCAP}`, '*a*́ b*', '/*️a*/', `{${KEYCAP}abc*}`]) {
      const written = carveToCarve(source)
      expect(written).toBe(`${source}\n`)
      expect(html(written)).toBe(html(source))
    }
  })

  it('braces a span whose closer would sit before an extender', () => {
    expect(htmlToCarve(`<p><strong>a</strong>️⃣</p>`).value).toBe('{*a*}️⃣\n')
    expect(htmlToCarve('<p><em>x</em>\u{E0100}</p>').value).toBe('{/x/}\u{E0100}\n')
    expect(htmlToCarve('<p><strong><em>a</em></strong>️</p>').value).toBe('{*/a/*}️\n')
  })

  it('does not spell a span whose content starts with an extender', () => {
    expect(htmlToCarve('<p><strong>́x</strong></p>').value).toBe('́x\n')
  })

  perfIt('scans a run of keycap openers in linear time', () => {
    expectScansLinearly((input) => void carveToHtml(input), `${KEYCAP}a `, {
      label: 'keycap openers',
      smallRepeats: 4000,
    })
  })

  perfIt('scans a run of decorated closers after one opener in linear time', () => {
    expectScansLinearly((input) => void carveToHtml(`*a${input}`), 'b*́ ', {
      label: 'decorated closers',
      smallRepeats: 4000,
    })
  })

  perfIt('scans a run of decorated forced openers in linear time', () => {
    expectScansLinearly((input) => void carveToHtml(input), '{*️a*} ', {
      label: 'decorated forced openers',
      smallRepeats: 3000,
    })
  })
})
