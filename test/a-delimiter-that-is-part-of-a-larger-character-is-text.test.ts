import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve, parse, renderCarve } from '../src/index.js'
import type { InlineNode } from '../src/index.js'
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

  it.each([
    ['{+\u20E3x+} {+y+}', '<p>{+\u20E3x+} <ins>y</ins></p>'],
    ['{-\uFE0Ex-} {-y-}', '<p>{-\uFE0Ex-} <del>y</del></p>'],
    ['{~\u0301a~>b~} {~c~>d~}', '<p>{~\u0301a~&gt;b~} <del>c</del><ins>d</ins></p>'],
    ['{#\uFE0F\u20E3 x#} {#y#}', '<p>{#\uFE0F\u20E3 x#} <span class="critic-comment">y</span></p>'],
    ['a{% y %}b {%\u093Ex%}', '<p>ab {%\u093Ex%}</p>'],
    ['{-\u0301-}', '<p>{-\u0301-}</p>'],
    ['{%\u200D%}', '<p>{%\u200D%}</p>'],
  ])('applies to the editorial and comment opener in %s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })

  it('leaves a decorated frame inside another as text', () => {
    expect(html('{+a {+\u0301b+} c+}')).toBe('<p><ins>a {+\u0301b</ins> c+}</p>')
    expect(html('{-a {-\u0301b-} c-}')).toBe('<p><del>a {-\u0301b</del> c-}</p>')
    expect(html('{~a {#\u0301 ~> #} b~}')).toBe('<p><del>a {#\u0301 </del><ins> #} b</ins></p>')
    expect(html('*a {%\u0301 b* %}')).toBe('<p><strong>a {%\u0301 b</strong> %}</p>')
  })

  it('does not hide a bracket behind a decorated comment opener', () => {
    expect(html('[a {#\u0301 ] #}](u)')).toBe('<p>[a {#\u0301 ] #}](u)</p>')
    expect(html('[x {%\u0301 ] %}](u)')).toBe('<p>[x {%\u0301 ] %}](u)</p>')
    expect(html('[a {# ] #}](u)')).toBe('<p><a href="u">a <span class="critic-comment"> ] </span></a></p>')
  })

  it('leaves an undecorated editorial or comment opener alone', () => {
    expect(html('{+\u200Bx+} {-y-} {~a~>b~} {#c#} d{% e %}')).toBe('<p><ins>\u200Bx</ins> <del>y</del> <del>a</del><ins>b</ins> <span class="critic-comment">c</span> d</p>')
  })

  it('refuses to write an editorial frame whose opener would be decorated', () => {
    const tree = parse('{+x+} {-x-} {~x~>y~} {#x#}\n')
    const paragraph = tree.children[0] as { children: InlineNode[] }
    const frames = paragraph.children.filter((node) => node.type !== 'text')
    expect(frames.map((node) => node.type)).toEqual(['insert', 'delete', 'substitution', 'critic_comment'])
    for (const frame of frames) {
      const one = structuredClone(tree)
      const decorated = structuredClone(frame) as InlineNode & { children?: InlineNode[]; old?: InlineNode[]; text?: string }
      const first = (decorated.children ?? decorated.old)?.[0] as { value: string } | undefined
      if (first) first.value = '\u0301x'
      else decorated.text = '\u0301x'
      ;(one.children[0] as { children: InlineNode[] }).children = [decorated]
      expect(() => renderCarve(one)).toThrow(/combining mark, a variation selector or a joiner/)
    }
  })

  it('does not spell an editorial frame whose content starts with an extender', () => {
    expect(htmlToCarve('<p><ins>\u0301x</ins></p>').value).toBe('\u0301x\n')
    expect(htmlToCarve('<p><del>\uFE0Ex</del></p>').value).toBe('\uFE0Ex\n')
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
      '*\u093Ex *y*', '{*\u093Ex*}', '{^\u20E3x^}', '{,\uFE0Ex,}', '{+\u20E3x+} {+y+}', '{-\uFE0Ex-} {-y-}',
      '{~\u0301a~>b~} {~c~>d~}', '{#\uFE0F\u20E3 x#} {#y#}', 'a{% y %}b {%\u093Ex%}']) {
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

  perfIt('scans a run of decorated editorial and comment openers in linear time', () => {
    expectScansLinearly((input) => void carveToHtml(input), '{+\u0301a+} {~\u0301b~>c~} {#\u0301d#} {%\u0301e%} ', {
      label: 'decorated editorial openers',
      smallRepeats: 1000,
    })
  })

  perfIt('scans a run of decorated superscript openers in linear time', () => {
    expectScansLinearly((input) => void carveToHtml(input), '{^\u093Ea^} ', {
      label: 'decorated superscript openers',
      smallRepeats: 3000,
    })
  })
})
