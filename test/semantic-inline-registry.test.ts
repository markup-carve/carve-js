import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToCarve, carveToHtml, carveToPlainText } from '../src/index.js'

const names = ['abbr', 'cite', 'dfn', 'kbd', 'samp', 'var', 'time', 'code', 'mark'] as const

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
