import { describe, expect, it } from 'vitest'

import { carveToCarve, carveToHtml, parse } from '../src/index.js'

/**
 * AN ESCAPED SPACE IN THE LAST COLUMN OF A LINE IS A HARD BREAK
 * (markup-carve/carve#1027).
 *
 * The trailing-whitespace strip runs BEFORE escape resolution, so the space in
 * `\ ` is gone by the time the escape is read and the bare backslash left
 * behind is a hard break. `resources/grammar.ebnf`, MARKER REQUIRES CONTENT,
 * decides it: "an editor stripping the trailing space cannot change the
 * meaning", and the clause states its own generality past the two markers it
 * names, "the rationale is a property of the separator space and applies
 * wherever one appears".
 *
 * This engine read it the other way: it carved the escaped space out of the
 * strip, so `x \ ` was a no-break space and `x \` - the same document after an
 * editor saved it - was a line break. carve-rs and carve-php were stable across
 * that strip and this now matches them node for node.
 *
 * The cost is deliberate and already paid twice, for the bullet marker and for
 * the definition-term marker: an escaped space means a no-break space mid-line
 * and a hard break at the end of a line. An author who wants a no-break space in
 * the last column writes the character, not the escape.
 */
describe('an escaped space in the last column of a line', () => {
  it('is a hard break at the end of a paragraph', () => {
    expect(carveToHtml('x \\ \n')).toBe('<p>x <br>\n</p>')
  })

  it('is a hard break before a soft break, not only at the end of a block', () => {
    expect(carveToHtml('x \\ \ny\n')).toBe('<p>x <br>\ny</p>')
  })

  it('means the same as the document an editor would save', () => {
    // The whole point of the rule: these four documents differ only in a
    // trailing run an editor is free to remove, so they are one document.
    const stripped = carveToHtml('x \\\ny\n')
    for (const run of [' ', '  ', ' \t', '\t', '   ']) {
      expect(carveToHtml(`x \\${run}\ny\n`)).toBe(stripped)
    }
  })

  it('is a hard break in every block that accumulates its lines', () => {
    // The strip reaches a paragraph, a definition term, a caption and every
    // paragraph hosted in a container. Each of these read as a no-break space.
    expect(carveToHtml('- i\\ \n  more\n')).toBe('<ul>\n  <li>i<br>\nmore</li>\n</ul>')
    expect(carveToHtml('> q\\ \n> more\n')).toBe('<blockquote><p>q<br>\nmore</p></blockquote>')
    expect(carveToHtml(':: t\\ \n:  d\n')).toBe('<dl>\n  <dt>t<br>\n</dt>\n  <dd>d</dd>\n</dl>')
    expect(carveToHtml('| a |\n^ C\\ \n')).toContain('<caption>C<br>\n</caption>')
  })

  it('builds the same nodes carve-rs and carve-php build', () => {
    // The HTML matching is not the assertion: the two engines disagreed in the
    // TREE, one text node against a text node plus a break, so the tree is what
    // has to line up. carve-rs `9304128` on `x \ ` + newline:
    //   text "x " 0->2, hard_break 2->3, the trailing space in no node at all.
    const doc = parse('x \\ \n')
    const para = doc.children[0]!
    expect(para.type).toBe('paragraph')
    const kids = (para as { children: Array<{ type: string; value?: string; pos?: unknown }> })
      .children
    expect(kids.map((k) => k.type)).toEqual(['text', 'hard_break'])
    expect(kids[0]!.value).toBe('x ')
    expect(kids[0]!.pos).toMatchObject({ startOffset: 0, endOffset: 2 })
    expect(kids[1]!.pos).toMatchObject({ startOffset: 2, endOffset: 3 })
  })

  it('leaves the escape alone anywhere but the last column', () => {
    // Mid-line the three engines never disagreed, and this rule must not reach
    // there: `10\ kg` is a no-break space and stays one.
    expect(carveToHtml('a 10\\ kg b\n')).toBe('<p>a 10&nbsp;kg b</p>')
    expect(carveToHtml('a\\ b\n')).toBe('<p>a&nbsp;b</p>')
  })

  it('leaves an EVEN backslash run alone, which is a literal backslash', () => {
    // `\\ ` is an escaped backslash followed by an ordinary trailing space, so
    // the space goes and no break is created.
    expect(carveToHtml('x \\\\ \n')).toBe('<p>x \\</p>')
  })

  it('keeps PART 11 section 1 on the source it used to break', () => {
    // The writer already dropped the space and emitted the bare backslash. With
    // the parse reading that as a hard break, the two halves agree.
    for (const src of ['x \\ \n', 'x \\ \ny\n', '- i\\ \n  more\n', '> q\\ \n> more\n']) {
      const once = carveToCarve(src)
      expect(carveToCarve(once)).toBe(once)
      expect(carveToHtml(once)).toBe(carveToHtml(src))
    }
  })
})

/**
 * The tree the parser can no longer build, which the AST-ingest path still can.
 *
 * PART 11 section 1a holds for a tree however it arrived, and `fromAstJson`
 * accepts a text node ending in the escaped-space placeholder even though no
 * source spells one any more. Written back as `\ ` it would re-parse as a hard
 * break, so the writer spells it as the character itself - which is not the
 * escape, but is the same rendered document and survives another pass.
 */
describe('an ingested text node ending in a no-break space', () => {
  const ingested = (value: string) =>
    JSON.stringify({
      type: 'document',
      srcByteLength: 3,
      children: [{ type: 'paragraph', children: [{ type: 'text', value }] }],
    })

  it('is written back as a character that survives the round trip', async () => {
    const { fromAstJson } = await import('../src/index.js')
    const { renderCarve } = await import('../src/render-carve.js')
    const { renderHtml } = await import('../src/render-html.js')
    const doc = fromAstJson(JSON.parse(ingested('a\ue000')), 3)
    const written = renderCarve(doc)
    // Not `a\` - that is a hard break - and not `a\ ` either, which is the same
    // thing after the strip.
    expect(written).toBe('a\u00a0\n')
    expect(carveToHtml(written)).toBe(renderHtml(doc))
    expect(carveToCarve(written)).toBe(written)
  })

  it('keeps the escape when the placeholder is not in the last column', () => {
    expect(carveToCarve('a\\ b\n')).toBe('a\\ b\n')
  })
})
