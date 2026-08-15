/*
 * PART 11 degradation for the §4c composite figure (D8):
 *
 *   Markdown - panels in source order, each host degraded as usual with its
 *   caption as an EMPHASIZED paragraph after it, stray content in place, and
 *   the group caption as a BOLD paragraph at the end.
 *
 *   Plain text / ANSI - the GROUP caption line first, a blank line, then per
 *   panel its caption line over its host degradation, blank line between.
 *
 * Tabs / `presentation=` hints are renderer-level and out of scope; hint
 * classes pass through in HTML only.
 */
import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'

const F1 =
  '{#fig-x .columns-2}\n::: figure\n{#fig-x-a}\n![one](a.png)\n^ (a) One\n\n{#fig-x-b}\n![two](b.png)\n^ (b) Two\n:::\n^ Figure #: Group caption\n'

const MIXED =
  '::: figure\nProse between.\n\n| K | N |\n|---|---|\n| a | 1 |\n\n``` js\nx\n```\n^ A listing\n:::\n^ Figure #: Mixed\n'

describe('a figure group degrades deterministically', () => {
  it('Markdown: hosts as usual, emphasized panel captions, bold group caption last', () => {
    // A BLANK line separates each host from its emphasized caption - the
    // caption is its own paragraph (carve-php / carve-rs parity).
    expect(carveToMarkdown(F1)).toBe(
      '![one](a.png)\n\n*(a) One*\n\n![two](b.png)\n\n*(b) Two*\n\n**Figure 1: Group caption**\n',
    )
  })

  it('Markdown: a table panel keeps its own degradation; stray prose stays in place', () => {
    expect(carveToMarkdown(MIXED)).toBe(
      'Prose between.\n\n| K | N |\n| --- | --- |\n| a | 1 |\n\n```js\nx\n```\n\n*A listing*\n\n**Figure 1: Mixed**\n',
    )
  })

  it('plain text: group caption line first, then caption-over-host per panel', () => {
    expect(carveToPlainText(F1)).toBe('Figure 1: Group caption\n\n(a) One\none\n\n(b) Two\ntwo\n')
  })

  it('plain text: stray prose stays in source order under the group caption', () => {
    expect(carveToPlainText(MIXED)).toBe(
      'Figure 1: Mixed\n\nProse between.\n\nK | N\na | 1\n\nA listing\nx\n',
    )
  })

  it('Markdown: a heading inside a group is a crossref target with an anchor', () => {
    // The prepass that indexes heading ids has to DESCEND into the group, or
    // a `</#...>` to a heading inside one degrades to plain text while the
    // heading loses its anchor stamp (carve-php / carve-rs parity).
    const src =
      'See </#inner-heading>.\n\n::: figure\n## Inner heading\n\n![x](x.png)\n^ (a) x\n:::\n^ Figure #: G\n'
    expect(carveToMarkdown(src)).toBe(
      'See [Inner heading](#Inner-heading).\n\n## Inner heading {#Inner-heading}\n\n![x](x.png)\n\n*(a) x*\n\n**Figure 1: G**\n',
    )
  })

  it('ANSI: the plain-text shape with caption styling', () => {
    const E = ''
    expect(carveToAnsi(F1)).toBe(
      `${E}[3m${E}[2mFigure 1: Group caption${E}[0m\n\n` +
        `${E}[3m${E}[2m(a) One${E}[0m\n${E}[35m[img:${E}[0m one${E}[35m]${E}[0m\n\n` +
        `${E}[3m${E}[2m(b) Two${E}[0m\n${E}[35m[img:${E}[0m two${E}[35m]${E}[0m\n`,
    )
  })
})
