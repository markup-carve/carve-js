// markup-carve/carve#4461 (PART 9R R4), #4463 (PART 10 I1c, I2), #4453 (frontmatter_open) and #4450 (R4).
import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a cross-reference to an empty caption label', () => {
  it('is the number alone', () => {
    expect(carveToHtml('{#t}\n| a |\n^ # x\n\n</#t>\n')).toContain('<p><a href="#t">1</a></p>')
  })

  it('is the number alone when the label holds only a comment', () => {
    expect(carveToHtml('{#t}\n| a |\n^ {% c %} # x\n\n</#t>\n')).toContain('<p><a href="#t">1</a></p>')
  })

  it('keeps the space after a label word', () => {
    expect(carveToHtml('{#t}\n| a |\n^ Table # x\n\n</#t>\n')).toContain('<p><a href="#t">Table 1</a></p>')
  })
})

describe('an unresolved code include', () => {
  it.each([
    ['a malformed language in a paragraph', 'x {{ a @code:a,b }} y', '<p>x {{ a @code:a,b }} y</p>'],
    ['a malformed language in a quote', '> {{ a @code:a,b }}', '<blockquote><p>{{ a @code:a,b }}</p></blockquote>'],
    ['a standalone line in a quote', '> {{ _a_ @code:js }}', '<blockquote><p>{{ _a_ @code:js }}</p></blockquote>'],
    ['a standalone line in an item', '- {{ *a* @code }}', '<ul>\n  <li>{{ *a* @code }}</li>\n</ul>'],
    ['a quote outside a quoted slot', "{{ it's_x @lines:0-1 }} it's_y }}", '<p>{{ it\'s_x @lines:0-1 }} it’s_y }}</p>'],
  ])('stays literal: %s', (_name, source, html) => {
    expect(carveToHtml(source + '\n')).toBe(html)
  })

  it('keeps core inline syntax on a quoted path', () => {
    expect(carveToHtml('> {{ "_a_" @code:js }}\n')).toBe('<blockquote><p>{{ “<u>a</u>” <span class="mention"><strong>@code</strong></span>:js }}</p></blockquote>')
  })
})

describe('an indented dash line', () => {
  it.each([
    ['neither opens frontmatter', ' ---\na\n---\nx\n'],
    ['nor closes it', '---\na\n ---\nx\n'],
  ])('%s', (_name, source) => {
    expect(carveToHtml(source)).toBe('<hr>\n<p>a</p>\n<hr>\n<p>x</p>')
  })
})

describe('a duplicate explicit heading id', () => {
  it('resolves a cross-reference to the first heading', () => {
    const html = carveToHtml('{#x}\n# A\n\n{#x}\n# B\n\n</#x>\n')
    expect(html).toContain('<p><a href="#x">A</a></p>')
    expect(html.match(/<section id="x">/g)).toHaveLength(2)
  })
})
