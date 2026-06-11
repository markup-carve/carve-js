import { describe, expect, it } from 'vitest'

import { carveToHtml, carveToMarkdown, parse } from '../src/index.js'

const h = (s: string) => carveToHtml(s).trim()

// Reach into the parsed caption to assert a caption-number node exists.
function captionTypes(src: string): string[] {
  const doc = parse(src)
  const fig = doc.children.find((b) => b.type === 'figure') as
    | { caption: { type: string }[] }
    | undefined
  return fig ? fig.caption.map((n) => n.type) : []
}

describe('parse: caption number placeholder', () => {
  it('emits a caption-number node for a bare # in a caption', () => {
    expect(captionTypes('![x](x.jpg)\n^ Figure #: A')).toContain('caption-number')
  })

  it('does not emit one for an escaped \\#', () => {
    expect(captionTypes('![x](x.jpg)\n^ Cost \\# units')).not.toContain('caption-number')
  })

  it('keeps #word as a tag, not a placeholder', () => {
    const types = captionTypes('![x](x.jpg)\n^ See #news')
    expect(types).toContain('tag')
    expect(types).not.toContain('caption-number')
  })

  it('only the first bare # becomes a placeholder', () => {
    const types = captionTypes('![x](x.jpg)\n^ Figure #: a # b')
    expect(types.filter((t) => t === 'caption-number')).toHaveLength(1)
  })
})

describe('resolve: caption numbering + crossrefs', () => {
  it('numbers a figure caption in place of the #', () => {
    expect(h('{#fig-a}\n![x](x.jpg)\n^ Figure #: A')).toContain(
      '<figcaption>Figure 1: A</figcaption>',
    )
  })

  it('numbers buckets independently, in document order', () => {
    const out = h(
      '![x](x.jpg)\n^ Figure #: one\n\n|= H |\n| c |\n^ Table #: t\n\n![y](y.jpg)\n^ Figure #: two',
    )
    expect(out).toContain('Figure 1: one')
    expect(out).toContain('Table 1: t')
    expect(out).toContain('Figure 2: two')
  })

  it('resolves </#id> to a numbered caption as label + number', () => {
    expect(h('{#fig-a}\n![x](x.jpg)\n^ Figure #: A\n\nSee </#fig-a>.')).toContain(
      'See <a href="#fig-a">Figure 1</a>.',
    )
  })

  it('resolves a forward reference (ref before the figure)', () => {
    expect(h('See </#fig-a>.\n\n{#fig-a}\n![x](x.jpg)\n^ Figure #: A')).toContain(
      'See <a href="#fig-a">Figure 1</a>.',
    )
  })

  it('keeps a non-numbered caption unchanged', () => {
    expect(h('![x](x.jpg)\n^ Plain caption')).toContain('<figcaption>Plain caption</figcaption>')
  })

  it('buckets German labels independently', () => {
    const out = h('![x](x.jpg)\n^ Figure #: a\n\n![y](y.jpg)\n^ Abbildung #: b')
    expect(out).toContain('Figure 1: a')
    expect(out).toContain('Abbildung 1: b')
  })

  it('numbers a captioned figure nested inside a captioned blockquote', () => {
    const out = h('> ![x](x.jpg)\n> ^ Figure #: inner\n\n^ Quote #: outer')
    expect(out).toContain('<figcaption>Figure 1: inner</figcaption>')
    expect(out).toContain('<figcaption>Quote 1: outer</figcaption>')
  })

  it('does not emit a broken anchor for a label with an implicit heading ref', () => {
    // The label `[Setup][]` resolves to the heading; the crossref auto-text
    // must clone the resolved link, never href="".
    const out = h('# Setup\n\n{#fig-a}\n![x](x.jpg)\n^ [Setup][] #: cap\n\nSee </#fig-a>.')
    expect(out).not.toContain('href=""')
  })

  it('does NOT treat a # inside inline markup as a placeholder (top-level only)', () => {
    // Documented scope: the placeholder is recognized in the caption's
    // top-level text, not inside emphasis/links. The # stays literal here.
    const out = h('![x](x.jpg)\n^ *Figure #*: cap')
    expect(out).toContain('<figcaption><strong>Figure #</strong>: cap</figcaption>')
  })
})

describe('listing captions (caption on a code block)', () => {
  const fence = '```python\nx = 1\n```'

  it('wraps a captioned code block in a figure with the pre inside', () => {
    const out = h(`${fence}\n^ Listing 1: example`)
    expect(out).toContain('<figure>')
    expect(out).toContain('<pre><code class="language-python">x = 1\n</code></pre>')
    expect(out).toContain('<figcaption>Listing 1: example</figcaption>')
  })

  it('leaves a code block without a caption as a bare pre (no figure)', () => {
    const out = h(fence)
    expect(out).not.toContain('<figure>')
    expect(out).toContain('<pre><code class="language-python">x = 1\n</code></pre>')
  })

  it('numbers a Listing caption in place of the #', () => {
    expect(h(`${fence}\n^ Listing #: example`)).toContain(
      '<figcaption>Listing 1: example</figcaption>',
    )
  })

  it('resolves </#id> to a numbered listing as label + number', () => {
    const out = h(`{#lst-a}\n${fence}\n^ Listing #: example\n\nSee </#lst-a>.`)
    expect(out).toContain('See <a href="#lst-a">Listing 1</a>.')
  })

  it('shares the per-label counter with other Listing captions', () => {
    const out = h(`${fence}\n^ Listing #: one\n\n${fence}\n^ Listing #: two`)
    expect(out).toContain('Listing 1: one')
    expect(out).toContain('Listing 2: two')
  })

  it('attaches a caption across a single blank line', () => {
    expect(h(`${fence}\n\n^ Listing #: spaced`)).toContain(
      '<figcaption>Listing 1: spaced</figcaption>',
    )
  })

  it('keeps the caption on its own line in Markdown output (not glued to the fence)', () => {
    const md = carveToMarkdown(`${fence}\n^ Listing #: example`)
    expect(md).toContain('```\nListing 1: example')
    expect(md).not.toContain('```Listing')
  })
})
