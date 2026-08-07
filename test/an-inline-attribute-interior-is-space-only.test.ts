import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * PART 4 spells every whitespace slot of the INLINE attribute block `space`,
 * and leaves the block-attribute LINE alone (markup-carve/carve#906,
 * markup-carve/carve-js#836).
 *
 * FIVE POSITIONS narrow, and they are five separate positions rather than one
 * separator rule, so they are worth checking one at a time: the run after `{`,
 * the run between two attributes, the run before `}`, the boundary after an
 * UNQUOTED value, and the blessed empty block `{ }`. All five sit AFTER the
 * first non-whitespace character of their line, which is where PART 7 already
 * says a tab is not syntax. A tab at any of them makes the block unrecognized
 * and its braces show.
 *
 * The BLOCK-ATTRIBUTE LINE does NOT narrow, and that is the ruling rather than
 * an omission: it is the one attribute block with a `continuation`, so the
 * whitespace after its newline IS a leading indentation run.
 *
 * A TAB and a SPACE are compared as a PAIR at every position. A rule spelled as
 * "the first character is a space" passes a tab-first fixture and still admits
 * `<SP><TAB>`, and the mirror spelling admits `<TAB><SP>`; both have been
 * written for real in this org, so the mixed runs are here in both orders.
 */

const TAB = '\t'
const SP = ' '

describe('an inline attribute block interior is space-only', () => {
  it('the run after `{` takes a space', () => {
    expect(carveToHtml('*y*{' + TAB + '.c}')).toBe('<p><strong>y</strong>{\t.c}</p>')
    expect(carveToHtml('*y*{' + SP + '.c}')).toBe('<p><strong class="c">y</strong></p>')
  })

  it('the run between two attributes takes a space', () => {
    expect(carveToHtml('*x*{.a' + TAB + '.b}')).toBe('<p><strong>x</strong>{.a\t.b}</p>')
    expect(carveToHtml('*x*{.a' + SP + '.b}')).toBe('<p><strong class="a b">x</strong></p>')
  })

  it('the run before `}` takes a space', () => {
    expect(carveToHtml('*z*{.d' + TAB + '}')).toBe('<p><strong>z</strong>{.d\t}</p>')
    expect(carveToHtml('*z*{.d' + SP + '}')).toBe('<p><strong class="d">z</strong></p>')
  })

  it('the boundary after an UNQUOTED value takes a space', () => {
    // A tab there ends the value and then satisfies no separator either, so
    // the whole block fails.
    expect(carveToHtml('*x*{k=a' + TAB + '.b}')).toBe('<p><strong>x</strong>{k=a\t.b}</p>')
    expect(carveToHtml('*x*{k=a' + SP + '.b}')).toBe('<p><strong k="a" class="b">x</strong></p>')
  })

  it('the blessed EMPTY block takes a space', () => {
    // A SEPARATE POSITION rather than a use of the separator, and the one most
    // likely to be missed: narrowing the separator alone leaves `[x]{<TAB>}` a
    // valid empty block, and the corpus document that pins it stays green.
    expect(carveToHtml('[x]{' + TAB + '}')).toBe('<p>[x]{\t}</p>')
    expect(carveToHtml('[x]{' + SP + '}')).toBe('<p><span>x</span></p>')
  })

  it('rejects a MIXED run in both orders, at every position', () => {
    // The guard against "the first character is a space" and against its
    // mirror. Both spellings pass every single-character fixture above.
    const positions = {
      'after `{`': (w: string) => '*y*{' + w + '.c}',
      'between two attributes': (w: string) => '*x*{.a' + w + '.b}',
      'before `}`': (w: string) => '*z*{.d' + w + '}',
      'after an unquoted value': (w: string) => '*x*{k=a' + w + '.b}',
      'the empty block': (w: string) => '[x]{' + w + '}',
    }
    for (const [name, mk] of Object.entries(positions)) {
      for (const run of [SP + TAB, TAB + SP, SP + SP + TAB, TAB + TAB]) {
        // The block is unrecognized, so its braces and the whole run survive
        // into the output verbatim. Only the block goes literal - the markup
        // around it still parses.
        const out = carveToHtml(mk(run))
        expect({ name, run: JSON.stringify(run), literal: out.includes('{') }).toEqual({
          name,
          run: JSON.stringify(run),
          literal: true,
        })
        expect({ name, run: JSON.stringify(run), keepsRun: out.includes(run) }).toEqual({
          name,
          run: JSON.stringify(run),
          keepsRun: true,
        })
      }
      // CONTROL: a run of SPACES at the same position is still a valid block,
      // so no brace survives. Without it every row above passes for a class
      // that rejects everything.
      expect({ name, brace: carveToHtml(mk(SP + SP)).includes('{') }).toEqual({
        name,
        brace: false,
      })
    }
  })

  it('CONTROL a tab inside a QUOTED value is content and does not narrow', () => {
    expect(carveToHtml('*y*{k="a' + TAB + 'b"}')).toBe('<p><strong k="a\tb">y</strong></p>')
    expect(carveToHtml("*y*{k='a" + TAB + "b'}")).toBe('<p><strong k="a\tb">y</strong></p>')
  })

  it('CONTROL the block-attribute LINE keeps whitespace at all three slots', () => {
    expect(carveToHtml('{' + TAB + '.a' + TAB + '.b' + TAB + '}\n\nparagraph')).toBe(
      '<p class="a b">paragraph</p>',
    )
  })

  it('CONTROL a block-attribute continuation may be indented with a tab', () => {
    // The reason the block-attribute line is the exception: after a
    // `continuation` the next line's leading whitespace IS indentation.
    expect(carveToHtml('{.a\n' + TAB + '.b}\n\nparagraph')).toBe('<p class="a b">paragraph</p>')
    expect(carveToHtml('{.a\n' + SP + '.b}\n\nparagraph')).toBe('<p class="a b">paragraph</p>')
  })

  it('narrows every INLINE surface, not only the one the report showed', () => {
    // The block is spelled in a dozen places - a trailing block on an
    // emphasis, a span tail, a link tail, an image tail, both reference forms,
    // an autolink tail, a footnote-reference tail, a marker-abutting item
    // block, a table cell, a table row, and a definition's trailing block.
    // Narrowing one of them is what leaves the rule half-implemented.
    const surfaces: Record<string, (w: string) => string> = {
      emphasis: (w) => '*x*{.a' + w + '.b}\n',
      span: (w) => '[x]{.a' + w + '.b}\n',
      'code span': (w) => '`x`{.a' + w + '.b}\n',
      'inline link': (w) => '[t](/u){.a' + w + '.b}\n',
      'reference link': (w) => '[t][r]{.a' + w + '.b}\n\n[r]: /u\n',
      image: (w) => '![alt](/i){.a' + w + '.b}\n',
      'image reference': (w) => '![alt][r]{.a' + w + '.b}\n\n[r]: /i\n',
      autolink: (w) => '<https://e.com/>{.a' + w + '.b}\n',
      'footnote reference': (w) => 'x[^f]{.a' + w + '.b}\n\n[^f]: n\n',
      'list item attributes': (w) => '-{.a' + w + '.b} item\n',
      'table cell attributes': (w) => '|{.a' + w + '.b}c | d |\n|---|---|\n| e | f |\n',
      'table row attributes': (w) => '| a |\n|---|\n| b |{.a' + w + '.b}\n',
      'link definition attributes': (w) => '[t][r]\n\n[r]: /u {.a' + w + '.b}\n',
      'image definition attributes': (w) => '![a][r]\n\n[r]: /i {.a' + w + '.b}\n',
    }
    const stillSeparating: string[] = []
    for (const [name, mk] of Object.entries(surfaces)) {
      // The tab form must NOT produce `class="a b"`, and the space form must.
      const tabHtml = carveToHtml(mk(TAB))
      const spaceHtml = carveToHtml(mk(SP))
      if (tabHtml.includes('class="a b"') || !spaceHtml.includes('class="a b"')) {
        stillSeparating.push(name)
      }
    }
    expect(stillSeparating).toEqual([])
  })
})
