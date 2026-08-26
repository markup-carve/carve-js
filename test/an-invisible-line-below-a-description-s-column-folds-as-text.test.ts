import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Below a definition description's content column an invisible line is lazy
 * paragraph text OF THAT CONTAINER (markup-carve/carve#1809, §10 I5 DEFINITION
 * OWNERSHIP IS COLUMN-SCOPED; markup-carve/carve-js#1550, corpus 430 and 431).
 *
 * This engine ejected it to DOCUMENT level, while folding the identical line one
 * host over in a list item - one rule, two answers, decided by which container
 * sat above it. §10 I5's missing half was WHICH container: "lazy paragraph text"
 * names an operation on an OPEN paragraph, so ending the container and emitting
 * the same characters one level out has not carried the sentence out.
 *
 * TWO MECHANISMS HAD TO CHANGE, and either alone leaves a HALF fold, which is
 * what corpus 430 and 430-2 are built to catch:
 *
 *  1. the interrupt test had to stop firing, or the body ends;
 *  2. the folded line had to keep its RESIDUAL INDENT into the `dd`, or its
 *     shape is recognized AGAIN one level in - the definition registers in the
 *     description's own table and the attribute attaches to the next paragraph
 *     inside the `dd`. `rebaseOverindentedBlocks` was rebasing the residue away
 *     because the collector passed no `eligible` set, which the list-item
 *     collector one screen over has had all along.
 *
 * So every row here asserts the CHARACTERS and, where the kind has one, the
 * absence of the registration.
 */
describe("an invisible line below a description's column folds as text", () => {
  const html = (src: string): string => carveToHtml(src)
  const folds = (line: string): string =>
    `<dl>\n  <dt>t</dt>\n  <dd>d\n${line}\ntail</dd>\n</dl>`

  it('folds every kind at both columns of the band', () => {
    // The band is two columns wide here and the answer does not move inside it.
    for (const indent of [' ', '  ']) {
      for (const line of ['[r]: /u', '[^f]: n', '{.k}', '*[A]: a', 'x']) {
        expect(html(`:: t\n:  d\n${indent}${line}\ntail\n`)).toBe(folds(line))
      }
    }
  })

  it('registers nothing, so a reference below it stays literal', () => {
    // The half-fold row: characters on the page AND an entry in the table is the
    // shape that passes a bytes-only assertion.
    expect(html(':: t\n:  d\n  [r]: /u\ntail\n\nSee [text][r].\n')).toBe(
      `${folds('[r]: /u')}\n<p>See [text][r].</p>`,
    )
    expect(html(':: t\n:  d\n  [^f]: n\ntail\n\nSee[^f]\n')).toBe(
      `${folds('[^f]: n')}\n<p>See[^f]</p>`,
    )
    expect(html(':: t\n:  d\n  *[A]: a\ntail\n\nA here\n')).toBe(
      `${folds('*[A]: a')}\n<p>A here</p>`,
    )
  })

  it('attaches nothing, so the attribute reaches no block inside the dd', () => {
    // The attribute kind fails differently from the definitions: it used to pass
    // the plain-line test, fold in AS AN ATTRIBUTE, and then be discarded by §15
    // A4 - so the authored characters reached neither the page nor a block.
    const out = html(':: t\n:  d\n  {.k}\ntail\n')
    expect(out).toBe(folds('{.k}'))
    expect(out).not.toContain('class=')
  })

  it('CONTROL: a comment is column-exempt and still renders nothing', () => {
    // Corpus 430-5. Waiving the comment along with the rest would put its
    // characters on the page.
    expect(html(':: t\n:  d\n  %% c\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>')
    expect(html(':: t\n:  d\n  %% c\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('CONTROL: a real OPENER below the column still ends the body', () => {
    // The amended clause is explicit that the bullet is about openers, so this
    // is the half that must NOT move. A fix that folded everything below the
    // column fails here.
    for (const indent of [' ', '  ']) {
      for (const opener of ['> q', '# h', '| a |', '---', '::: note']) {
        expect(html(`:: t\n:  d\n${indent}${opener}\n`).startsWith('<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n')).toBe(true)
      }
    }
  })

  it('CONTROL: at column 0 the description ends and the line acts', () => {
    // Corpus 431 and 431-4. Column 0 is the document's own opener column: a
    // definition registers, a floating attribute attaches forward.
    const dd = '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n'
    expect(html(':: t\n:  d\n{.k}\ntail\n')).toBe(`${dd}<p class="k">tail</p>`)
    expect(html(':: t\n:  d\n[r]: /u\n\nSee [text][r].\n')).toBe(
      `${dd}<p>See <a href="/u">text</a>.</p>`,
    )
  })

  it('CONTROL: AT the content column the line is inside the description', () => {
    // Not this band. A definition at the column is collected, and an attribute
    // at the column is scoped to the description and dropped by §15 A4 (corpus
    // 329-a-floating-attribute-is-scoped-to-the-container-that-holds-it-5).
    const dd = '<dl>\n  <dt>t</dt>\n  <dd>d</dd>\n</dl>\n'
    expect(html(':: t\n:  d\n   [r]: /u\ntail\n\nSee [text][r].\n')).toBe(
      `${dd}<p>tail</p>\n<p>See <a href="/u">text</a>.</p>`,
    )
    expect(html(':: t\n:  d\n   {.k}\ntail\n')).toBe(`${dd}<p>tail</p>`)
  })

  it('CONTROL: the list-item host it now agrees with', () => {
    // The host whose answer this is, in the same build - it was their
    // disagreement that was the defect, and one host cannot record it.
    expect(html('- d\n [r]: /u\ntail\n')).toBe('<ul>\n  <li>d\n[r]: /u\ntail</li>\n</ul>')
  })
})
