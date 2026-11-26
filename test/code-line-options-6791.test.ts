import { describe, expect, it } from 'vitest'
import { type Attrs, render } from '../public/index.ts'

const F = '`'.repeat(3)

// carve#6791. C2-H-063, C2-H-211: the line options of a captioned code block stay on its <pre>.
describe('C2-H-063: the line options of a captioned code block', () => {
  it('stay on the <pre> of a figure-group panel, and the other attributes go on the panel', () => {
    const source = `::: figure\n{.wide .line-numbers data-highlight=2}\n${F}js\nx\n${F}\n^ A\n:::\n^ Both\n`
    expect(render(source)).toBe(
      '<figure class="carve-figure-group">\n  <figure class="carve-figure-panel wide">\n'
      + '    <pre class="line-numbers" data-highlight="2"><code class="language-js">x\n</code></pre>\n'
      + '    <figcaption>A</figcaption>\n  </figure>\n  <figcaption>Both</figcaption>\n</figure>',
    )
  })

  it('reach codeBlockRenderer in attrs, without the attributes of the figure (C2-H-206)', () => {
    const seen: (Attrs | undefined)[] = []
    const source = `{#f .x .line-numbers lang=de data-line-start=3 data-y=z}\n${F}ts\nx\n${F}\n^ cap\n`
    const html = render(source, { codeBlockRenderer: (node) => { seen.push(node.attrs); return null } })
    expect(seen).toEqual([{ classes: ['line-numbers'], keyValues: [['data-line-start', '3']] }])
    expect(html).toContain('<figure id="f" class="x" lang="de" data-y="z">')
  })

  it('leave a figure without attributes when only line options are written', () => {
    expect(render(`{data-line-start=5}\n${F}\nx\n${F}\n^ cap\n`)).toBe(
      '<figure>\n  <pre data-line-start="5"><code>x\n</code></pre>\n  <figcaption>cap</figcaption>\n</figure>',
    )
  })

  it('are no exception for a captioned quote', () => {
    expect(render('{.line-numbers}\n> q\n^ cap\n')).toBe(
      '<figure class="line-numbers">\n  <blockquote><p>q</p></blockquote>\n  <figcaption>cap</figcaption>\n</figure>',
    )
  })
})
