import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// CARVE-P3-025 (markup-carve/carve#3209): a delimiter followed by a combining
// mark (Mn, Mc or Me), a variation selector or U+200D is part of a larger
// character.
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
    // Spacing marks (Mc): U+093E and U+0903.
    ['*\u093Ex *y*', '<p>*\u093Ex <strong>y</strong></p>'],
    ['*a*\u093E b*', '<p><strong>a*\u093E b</strong></p>'],
    ['/x/\u0903', '<p>/x/\u0903</p>'],
    ['{*\u093Ex*}', '<p>{*\u093Ex*}</p>'],
    ['/*\u093Ea*/', '<p><em>*\u093Ea*</em></p>'],
  ])('%s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('applies to a forced opener of the bare delimiters', () => {
    expect(html(`{${KEYCAP}abc*}`)).toBe(`<p>{${KEYCAP}abc*}</p>`)
    expect(html('{/️x/}')).toBe('<p>{/️x/}</p>')
    expect(html('{*a {*́b*} c*}')).toBe('<p><strong>a {*́b</strong> c*}</p>')
  })

  it('applies to the superscript and subscript openers too', () => {
    expect(html('{^️a^}')).toBe('<p>{^️a^}</p>')
    expect(html('{,́a,}')).toBe('<p>{,́a,}</p>')
    expect(html('{^\u20E3x^}')).toBe('<p>{^\u20E3x^}</p>')
    expect(html('{,\uFE0Ex,}')).toBe('<p>{,\uFE0Ex,}</p>')
    expect(html('{^\u093Ex^}')).toBe('<p>{^\u093Ex^}</p>')
    expect(html('{*a {^́b^} c*}')).toBe('<p><strong>a {^́b^} c</strong></p>')
    expect(html('{^́x {^y^}')).toBe('<p>{^́x <sup>y</sup></p>')
  })

  // Controls: an undecorated opener and a format character (U+200B, Cf) are
  // outside the clause.
  it('leaves an opener before anything else alone', () => {
    expect(html('a{^x^} {,y,}')).toBe('<p>a<sup>x</sup> <sub>y</sub></p>')
    expect(html('{^\u200Bx^}')).toBe('<p><sup>\u200Bx</sup></p>')
    expect(html('x *\u200By* z')).toBe('<p>x <strong>\u200By</strong> z</p>')
  })

  it('applies to both halves of the combined token', () => {
    expect(html('/*️a*/')).toBe('<p><em>*️a*</em></p>')
    expect(html('/*a*/️')).toBe('<p>/<strong>a</strong>/️</p>')
  })

  it('writes source that reads back the same tree', () => {
    for (const source of [`${KEYCAP}abc*`, `*a${KEYCAP}`, '*a*́ b*', '/*️a*/', `{${KEYCAP}abc*}`,
      '*\u093Ex *y*', '{*\u093Ex*}', '{^\u20E3x^}', '{,\uFE0Ex,}']) {
      const written = carveToCarve(source)
      expect(written).toBe(`${source}\n`)
      expect(html(written)).toBe(html(source))
    }
  })

  it('writes a decorated superscript opener inside a span as text', () => {
    expect(carveToCarve('{*a {^́b^} c*}')).toBe('*a {^́b^} c*\n')
  })

  it('braces a span whose closer would sit before an extender', () => {
    expect(htmlToCarve(`<p><strong>a</strong>️⃣</p>`).value).toBe('{*a*}️⃣\n')
    expect(htmlToCarve('<p><em>x</em>\u{E0100}</p>').value).toBe('{/x/}\u{E0100}\n')
    expect(htmlToCarve('<p><strong><em>a</em></strong>️</p>').value).toBe('{*/a/*}️\n')
    expect(htmlToCarve('<p><strong>a</strong>\u093E</p>').value).toBe('{*a*}\u093E\n')
  })

  it('does not spell a span whose content starts with an extender', () => {
    expect(htmlToCarve('<p><strong>́x</strong></p>').value).toBe('́x\n')
    expect(htmlToCarve('<p><strong>\u093Ex</strong></p>').value).toBe('\u093Ex\n')
    expect(htmlToCarve('<p><sup>\u20E3x</sup></p>').value).toBe('\u20E3x\n')
    expect(htmlToCarve('<p><sub>\uFE0Ex</sub></p>').value).toBe('\uFE0Ex\n')
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

  perfIt('scans a run of decorated superscript openers in linear time', () => {
    expectScansLinearly((input) => void carveToHtml(input), '{^\u093Ea^} ', {
      label: 'decorated superscript openers',
      smallRepeats: 3000,
    })
  })
})
