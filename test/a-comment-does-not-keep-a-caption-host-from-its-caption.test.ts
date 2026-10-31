import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).replace(/>\s+</g, '><').trim()

// markup-carve/carve#4621, PART 9R: the filter that decides which paragraphs
// carry a caption slot is shared by math and image hosts, and a comment renders
// nothing, so it does not count as content.
describe('a comment does not keep a caption host from its caption', () => {
  it('captions a display math span with a trailing line comment', () => {
    expect(h('$$`a` %% c\n^ cap')).toBe(
      '<figure><p><span class="math display" role="math">\\[a\\]</span></p><figcaption>cap</figcaption></figure>',
    )
  })

  it('captions an image behind a braced comment', () => {
    expect(h('{%%}![a](/i)\n^ cap')).toBe('<figure><img src="/i" alt="a"><figcaption>cap</figcaption></figure>')
    expect(h('{%x\ny%}![a](/i)\n^ cap')).toBe('<figure><img src="/i" alt="a"><figcaption>cap</figcaption></figure>')
    expect(h('> {%x%}![a](/i)\n> ^ cap')).toBe(
      '<blockquote><figure><img src="/i" alt="a"><figcaption>cap</figcaption></figure></blockquote>',
    )
  })

  it('numbers the caption of a host that held a comment', () => {
    expect(h('{%%}![a](/i)\n^ Figure #: x')).toContain('<figcaption>Figure 1: x</figcaption>')
    expect(h('![a](/i) %% c\n^ Figure #: x')).toContain('<figcaption>Figure 1: x</figcaption>')
  })

  it('starts a block at a second caret line', () => {
    expect(h('{%%}![a](/i)\n^ cap\n^ two')).toBe(
      '<figure><img src="/i" alt="a"><figcaption>cap</figcaption></figure><p>^ two</p>',
    )
  })

  it('keeps a paragraph where the comment leaves a space beside the host', () => {
    expect(h('$$`a` {%x%}\n^ cap')).toBe('<p><span class="math display" role="math">\\[a\\]</span> \n^ cap</p>')
    expect(h('{%x%} ![a](/i)\n^ cap\n^ two')).toBe('<p><img src="/i" alt="a">\n^ cap\n^ two</p>')
  })
})

// markup-carve/carve#4622, PART 10 §1: a base class joins the authored class
// slot, so it takes that slot's first spelling.
describe('a base class takes the authored class slot spelling', () => {
  it('spells a task list and a math span with the authored key', () => {
    expect(h('{CLASS=c}\n- [ ] a')).toContain('<ul CLASS="task-list c">')
    expect(h('$`a`{CLASS=c}')).toBe('<p><span CLASS="math inline c" role="math">\\(a\\)</span></p>')
    expect(h('$`a`{.d CLASS=c}')).toBe('<p><span class="math inline d c" role="math">\\(a\\)</span></p>')
  })
})

// markup-carve/carve#4616, CARVE-P2-022: the number does not join a tag,
// mention or closer before the placeholder.
describe('a caption number stays outside the construct before it', () => {
  it('leaves a tag, a mention and a strong closer intact', () => {
    const doc = (cap: string) => h(`{#t}\n| b |\n^ ${cap}\n\n</#t>`)
    expect(doc('#y#')).toContain('<caption><span class="tag"><strong>#y</strong></span>1</caption>')
    expect(doc('@m#: c')).toContain('<caption><span class="mention"><strong>@m</strong></span>1: c</caption>')
    expect(doc('*a*#')).toContain('<caption><strong>a</strong>1</caption>')
  })
})
