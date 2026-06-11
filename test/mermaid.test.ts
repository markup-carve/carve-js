import { describe, expect, it } from 'vitest'

import { carveToHtml, mermaid, type CarveExtension, type CodeBlock } from '../src/index.js'

describe('mermaid extension', () => {
  it('renders a mermaid code block as <pre class="mermaid">', () => {
    const src = '``` mermaid\ngraph TD; A-->B\n```'
    expect(carveToHtml(src, { extensions: [mermaid()] })).toBe(
      '<pre class="mermaid">graph TD; A-->B</pre>',
    )
  })

  it('keeps > but escapes < and &', () => {
    const src = '``` mermaid\nA & B < C --> D\n```'
    expect(carveToHtml(src, { extensions: [mermaid()] })).toBe(
      '<pre class="mermaid">A &amp; B &lt; C --> D</pre>',
    )
  })

  it('defers non-mermaid code blocks to the core renderer', () => {
    const src = '``` js\nconst x = 1\n```'
    expect(carveToHtml(src, { extensions: [mermaid()] })).toBe(
      '<pre><code class="language-js">const x = 1\n</code></pre>',
    )
  })

  it('is inert without the extension (mermaid renders as plain code)', () => {
    const src = '``` mermaid\ngraph TD; A-->B\n```'
    expect(carveToHtml(src)).toBe(
      '<pre><code class="language-mermaid">graph TD; A--&gt;B\n</code></pre>',
    )
  })

  it('carries a preceding block-attribute line onto the pre and merges the mermaid class', () => {
    const src = '{#d1 .bordered}\n``` mermaid\ngraph TD; A-->B\n```'
    expect(carveToHtml(src, { extensions: [mermaid()] })).toBe(
      '<pre id="d1" class="mermaid bordered">graph TD; A-->B</pre>',
    )
  })

  it('honors a custom cssClass', () => {
    const src = '``` mermaid\nx\n```'
    expect(carveToHtml(src, { extensions: [mermaid({ cssClass: 'diagram' })] })).toBe(
      '<pre class="diagram">x</pre>',
    )
  })

  it('defers non-mermaid fences to a later code-block renderer (composition)', () => {
    // mermaid claims only `mermaid` blocks; a `js` block must still reach a
    // second code-block extension registered after it (block renderers chain).
    const highlight: CarveExtension = {
      name: 'highlight',
      blockRenderers: {
        'code-block': (node) => {
          const code = node as CodeBlock
          return code.lang === 'js' ? `<pre class="hl">${code.content}</pre>` : undefined
        },
      },
    }
    expect(
      carveToHtml('``` js\nconst x = 1\n```', { extensions: [mermaid(), highlight] }),
    ).toBe('<pre class="hl">const x = 1</pre>')
    expect(
      carveToHtml('``` mermaid\ngraph TD; A-->B\n```', { extensions: [mermaid(), highlight] }),
    ).toBe('<pre class="mermaid">graph TD; A-->B</pre>')
  })
})
