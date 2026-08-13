import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToCarve, carveToHtml, carveToPlainText } from '../src/index.js'

const names = ['abbr', 'cite', 'dfn', 'kbd', 'samp', 'var', 'time'] as const

describe('built-in semantic inline registry', () => {
  for (const name of names) {
    it(`renders :${name} as its matching HTML element`, () => {
      expect(carveToHtml(`:${name}[x]`)).toBe(`<p><${name}>x</${name}></p>`)
    })
  }

  it('keeps nested content and hardened authored attributes on the element', () => {
    expect(carveToHtml(':time[*noon*]{#clock .local datetime="12:00" onclick="x"}')).toBe(
      '<p><time id="clock" class="local" datetime="12:00"><strong>noon</strong></time></p>',
    )
  })

  it('leaves the two names Carve already spells on the generic fallback', () => {
    // PART 9 §9: the registry holds no element the language can already
    // write, so these take the ext- fallback rather than their tag.
    expect(carveToHtml(':code[*b*]')).toBe('<p><span class="ext-code"><strong>b</strong></span></p>')
    expect(carveToHtml(':mark[*b*]')).toBe('<p><span class="ext-mark"><strong>b</strong></span></p>')
    expect(carveToHtml('`*b*`')).toBe('<p><code>*b*</code></p>')
    expect(carveToHtml('=*b*=')).toBe('<p><mark><strong>b</strong></mark></p>')
  })

  it('keeps unknown names on the generic fallback', () => {
    expect(carveToHtml(':widget[x]{.control}')).toBe(
      '<p><span class="ext-widget control">x</span></p>',
    )
  })

  it('renders only content in plain and ANSI and preserves source spelling', () => {
    const source = ':abbr[*HTML*]{title="HyperText Markup Language"}'
    expect(carveToPlainText(source)).toBe('HTML\n')
    expect(carveToAnsi(source)).toContain('HTML')
    expect(carveToCarve(source)).toBe(source + '\n')
  })
})
