/*
 * Own-output round trip for the §4c composite figure: the `carve-figure-group`
 * class marks the wrapper, the panels div unwraps, a `carve-figure-panel`
 * figure comes back as the panel it rendered from, and the bare table-panel
 * wrapper (which carries no figcaption) unwraps to the table so its caption
 * and attrs stay its own. A foreign nested <figure> without the class keeps
 * the pre-existing unwrap behavior.
 */
import { describe, it, expect } from 'vitest'
import { carveToHtml, htmlToCarve, htmlToAst } from '../src/index.js'

describe('html import reads a figure group back', () => {
  it('round-trips the two-panel group shape', () => {
    const src =
      '{#fig-x .columns-2}\n::: figure\n{#fig-x-a}\n![one](a.png)\n^ (a) One\n\n{#fig-x-b}\n![two](b.png)\n^ (b) Two\n:::\n^ Figure #: Group caption\n'
    // The rendered page carries the RESOLVED number, so the reimported caption
    // says "Figure 1" where the source said "#" - the same trade every
    // numbered caption makes on this path.
    expect(htmlToCarve(carveToHtml(src)).value).toBe(
      '{#fig-x .columns-2}\n::: figure\n{#fig-x-a}\n![one](a.png)\n^ (a) One\n\n{#fig-x-b}\n![two](b.png)\n^ (b) Two\n:::\n^ Figure 1: Group caption\n',
    )
  })

  it('imports the group as a figure_group node with the marker classes stripped', () => {
    const html = carveToHtml('::: figure\n![a](x.png)\n^ (a) c\n:::\n^ Figure #: G')
    const doc = htmlToAst(html).value
    const group = doc.children.find((c) => c.type === 'figure_group')
    expect(group).toBeDefined()
    expect(JSON.stringify(group)).not.toContain('carve-figure-')
  })

  it('unwraps a bare table-panel wrapper back to the table', () => {
    const html = carveToHtml('::: figure\n| K |\n|---|\n| a |\n:::\n^ Figure #: G')
    const doc = htmlToAst(html).value
    const group = doc.children.find((c) => c.type === 'figure_group') as {
      children: Array<{ type: string }>
    }
    expect(group.children.map((c) => c.type)).toEqual(['table'])
  })

  it('a captionless group comes back without a caption', () => {
    const html = carveToHtml('::: figure\n![a](x.png)\n^ (a) c\n:::')
    const doc = htmlToAst(html).value
    const group = doc.children.find((c) => c.type === 'figure_group') as { caption?: unknown }
    expect(group.caption).toBeUndefined()
  })

  it('leaves a foreign figure without the class on the pre-existing path', () => {
    const html = '<figure><img src="x.png" alt="a"><figcaption>c</figcaption></figure>'
    const doc = htmlToAst(html).value
    expect(doc.children[0]).toMatchObject({ type: 'figure' })
  })
})
