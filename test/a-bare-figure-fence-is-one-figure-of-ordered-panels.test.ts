/*
 * PART 9 §4c composite figures: a BARE `::: figure` opener always produces a
 * `figure_group`, whatever its content count; an opener carrying a quoted
 * title or a `[label]` never matches the figure production and stays a generic
 * container; a bare opener inside an open group's body is demoted the same way
 * (groups do not nest). The corpus (318-composite-figures*) pins the F1-F10
 * byte shapes; these tests pin the shapes and edges the corpus leaves out.
 */
import { describe, it, expect } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

describe('a bare figure fence is one figure of ordered panels', () => {
  it('parses to a figure_group node discriminated by type, with no target', () => {
    const doc = parse('::: figure\n![a](x.png)\n^ (a) c\n:::\n')
    expect(doc.children[0]).toMatchObject({ type: 'figure_group' })
    expect(doc.children[0]).not.toHaveProperty('target')
  })

  it('an empty group still renders the panels wrapper', () => {
    expect(h('::: figure\n:::')).toBe(
      '<figure class="carve-figure-group">\n' +
        '  <div class="carve-figure-panels">\n' +
        '  </div>\n' +
        '</figure>',
    )
  })

  it('a group auto-closed at end of input is a group without a caption slot', () => {
    // §4c: the caption attaches at the CLOSING fence; a group closed by end of
    // input has no closer line to host the slot - and no lines after it either.
    expect(h('::: figure\n![a](x.png)\n^ (a) c')).toBe(
      '<figure class="carve-figure-group">\n' +
        '  <div class="carve-figure-panels">\n' +
        '    <figure class="carve-figure-panel">\n' +
        '      <img src="x.png" alt="a">\n' +
        '      <figcaption>(a) c</figcaption>\n' +
        '    </figure>\n' +
        '  </div>\n' +
        '</figure>',
    )
  })

  it('a group nests inside a blockquote like any block', () => {
    expect(h('> ::: figure\n> ![a](x.png)\n> ^ (a) c\n> :::')).toBe(
      '<blockquote>\n' +
        '  <figure class="carve-figure-group">\n' +
        '    <div class="carve-figure-panels">\n' +
        '      <figure class="carve-figure-panel">\n' +
        '        <img src="x.png" alt="a">\n' +
        '        <figcaption>(a) c</figcaption>\n' +
        '      </figure>\n' +
        '    </div>\n' +
        '  </figure>\n' +
        '</blockquote>',
    )
  })

  it('the group caption attaches across at most one blank line', () => {
    expect(h('::: figure\n![a](x.png)\n^ (a) c\n:::\n\n^ Figure #: Cap')).toContain(
      '<figcaption>Figure 1: Cap</figcaption>',
    )
  })

  it('the group caption folds continuation lines like a paragraph', () => {
    expect(h('::: figure\n![a](x.png)\n^ (a) c\n:::\n^ Figure #: Cap\nfolds on')).toContain(
      '<figcaption>Figure 1: Cap\nfolds on</figcaption>',
    )
  })

  it('an opener with a title stays a generic container even nested-free', () => {
    const doc = parse('::: figure "T"\nBody.\n:::\n')
    expect(doc.children[0]).toMatchObject({ type: 'admonition', kind: 'figure', title: [{ type: 'text', value: 'T' }] })
  })

  it('an opener with a [label] stays a generic container', () => {
    const doc = parse('::: figure [g]\nBody.\n:::\n')
    expect(doc.children[0]).toMatchObject({ type: 'admonition', kind: 'figure', label: 'g' })
  })

  it('a bare figure opener demotes anywhere inside an open group body', () => {
    // Not only as a DIRECT child: the no-nesting rule follows the recursion,
    // so a bare `::: figure` inside a note inside a group is demoted too.
    const doc = parse(
      '::: figure\n:::: note\n::::: figure\n![a](x.png)\n^ (a) c\n:::::\n::::\n:::\n',
    )
    const group = doc.children[0]!
    expect(group.type).toBe('figure_group')
    const note = (group as { children: Array<{ type: string; kind?: string; children?: unknown[] }> })
      .children[0]!
    expect(note).toMatchObject({ type: 'admonition', kind: 'note' })
    expect(note.children![0]).toMatchObject({ type: 'admonition', kind: 'figure' })
  })

  it('a sibling group after a closed group is a group again', () => {
    const doc = parse('::: figure\n:::\n\n::: figure\n:::\n')
    expect(doc.children.map((c) => c.type)).toEqual(['figure_group', 'figure_group'])
  })

  it('a reference image with a caption becomes a panel too', () => {
    // The syntactic block-image pass only knows the inline `![…](…)` form; a
    // reference image is promoted after resolution, and the promotion pass
    // descends into group children.
    expect(h('::: figure\n![a][r]\n^ (a) c\n:::\n\n[r]: /u.png')).toBe(
      '<figure class="carve-figure-group">\n' +
        '  <div class="carve-figure-panels">\n' +
        '    <figure class="carve-figure-panel">\n' +
        '      <img src="/u.png" alt="a">\n' +
        '      <figcaption>(a) c</figcaption>\n' +
        '    </figure>\n' +
        '  </div>\n' +
        '</figure>',
    )
  })

  it('an authored marker class does not double the injected one', () => {
    // The class merge keeps first occurrence and dedupes, the oracle's
    // renderBlockAttrs rule - so `{.carve-figure-group}` on the group (or the
    // panel marker on a panel) emits the token once.
    const out = h(
      '{.carve-figure-group}\n::: figure\n{.carve-figure-panel .wide}\n![a](x.png)\n^ (a) c\n:::',
    )
    expect(out).toContain('<figure class="carve-figure-group">')
    expect(out).toContain('<figure class="carve-figure-panel wide">')
    expect(out).not.toContain('carve-figure-group carve-figure-group')
    expect(out).not.toContain('carve-figure-panel carve-figure-panel')
  })

  it('an uncaptioned image is group content, not a panel', () => {
    // §4c: the panels are the figure and table children. A bare image never
    // became a figure, so it sits in the wrapper as preserved content.
    expect(h('::: figure\n![a](x.png)\n:::')).toBe(
      '<figure class="carve-figure-group">\n' +
        '  <div class="carve-figure-panels">\n' +
        '    <img src="x.png" alt="a">\n' +
        '  </div>\n' +
        '</figure>',
    )
  })
})
