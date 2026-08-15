/*
 * PART 9 §4c numbering: the group consumes ONE number from the shared
 * per-label sequence; panels consume none. A panel id resolves `</#id>` with
 * the group's number plus a letter by panel order (`Figure 2a`); a `#` in a
 * PANEL caption stays literal - panels are not sequence units.
 */
import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

describe('a figure group is one numbering unit with lettered panels', () => {
  it('the group draws one number; panels draw none', () => {
    const out = h(
      '![lead](l.png)\n^ Figure #: First\n\n::: figure\n![a](x.png)\n^ (a) c\n:::\n^ Figure #: Second\n\n![tail](t.png)\n^ Figure #: Third',
    )
    expect(out).toContain('<figcaption>Figure 1: First</figcaption>')
    expect(out).toContain('<figcaption>Figure 2: Second</figcaption>')
    expect(out).toContain('<figcaption>Figure 3: Third</figcaption>')
  })

  it('panel ids resolve with the group number plus a letter, tables included', () => {
    const out = h(
      '{#g}\n::: figure\n{#p-a}\n![a](x.png)\n^ a\n\n{#p-b}\n| h |\n|---|\n| c |\n\n{#p-c}\n``` js\nx\n```\n^ c\n:::\n^ Figure #: G\n\n</#p-a> </#p-b> </#p-c> </#g>',
    )
    expect(out).toContain('<a href="#p-a">Figure 1a</a>')
    expect(out).toContain('<a href="#p-b">Figure 1b</a>')
    expect(out).toContain('<a href="#p-c">Figure 1c</a>')
    expect(out).toContain('<a href="#g">Figure 1</a>')
  })

  it('letters count panels only, not stray content between them', () => {
    const out = h(
      '::: figure\nA note between panels.\n\n{#p-a}\n![a](x.png)\n^ a\n\nMore prose.\n\n{#p-b}\n![b](y.png)\n^ b\n:::\n^ Figure #: G\n\n</#p-b>',
    )
    expect(out).toContain('<a href="#p-b">Figure 1b</a>')
  })

  it('a # in a panel caption stays literal', () => {
    const out = h('::: figure\n![a](x.png)\n^ Figure #: not numbered\n:::\n^ Figure #: G')
    expect(out).toContain('<figcaption>Figure #: not numbered</figcaption>')
    expect(out).toContain('<figcaption>Figure 1: G</figcaption>')
  })

  it('an uncaptioned group numbers nothing and registers no panel ids', () => {
    const out = h('::: figure\n{#p}\n![a](x.png)\n^ a\n:::\n\n</#p>')
    // The crossref degrades to its literal source text, like any other
    // `</#id>` whose target never registered an auto-text.
    expect(out).toContain('&lt;/#p&gt;')
  })

  it('the group label word keys the sequence, shared with plain figures', () => {
    const out = h(
      '| h |\n|---|\n| c |\n^ Table #: T1\n\n::: figure\n![a](x.png)\n^ a\n:::\n^ Table #: T2',
    )
    expect(out).toContain('<caption>Table 1: T1</caption>')
    expect(out).toContain('<figcaption>Table 2: T2</figcaption>')
  })
})
