import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).replace(/\s+/g, ' ').trim()

describe('an attribute block after an inert node stays literal (not dropped)', () => {
  // Regression: carve-js used to attach a trailing `{...}` to any non-text
  // node, including inert ones whose renderer emits no attributes (mention,
  // tag, soft/hard break) - so the block was silently discarded. It must stay
  // literal, matching carve-rs / carve-php. carve#295 pre-release fuzz.
  it('keeps `{...}` literal after a mention', () => {
    expect(h('@u{k=v.w}')).toBe('<p><span class="mention"><strong>@u</strong></span>{k=v.w}</p>')
    expect(h('@u{.cls}')).toBe('<p><span class="mention"><strong>@u</strong></span>{.cls}</p>')
  })

  it('keeps `{...}` literal after a tag', () => {
    expect(h('#t{k=v}')).toBe('<p><span class="tag"><strong>#t</strong></span>{k=v}</p>')
  })

  it('keeps `{...}` literal after a soft break (continuation line)', () => {
    expect(h('x\n{k=v}y')).toBe('<p>x {k=v}y</p>')
  })
})

describe('legitimate attribute attachment is unaffected', () => {
  it('still attaches to real elements', () => {
    expect(h('[s]{.c}')).toBe('<p><span class="c">s</span></p>')
    expect(h('`c`{.c}')).toBe('<p><code class="c">c</code></p>')
    expect(h('*b*{k=v}')).toBe('<p><strong k="v">b</strong></p>')
    expect(h('!`x`{.c}')).toBe('<p><span class="c">x</span></p>')
    expect(h(':sym:{.c}')).toBe('<p><span class="c">:sym:</span></p>')
  })
})
