import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('thematic break', () => {
  it('matches 3+ of the same char, with or without spaces', () => {
    for (const s of ['---', '***', '___', '- - -', '* * *', '_ _ _', '- - - -', '-  -  -']) {
      expect(html(s)).toBe('<hr>')
    }
  })

  it('does not match a mixed run or fewer than three', () => {
    expect(html('-*-')).toBe('<p>-*-</p>')
    // two dashes is not a break; `--` is smart-typography en-dash
    expect(html('--')).toBe('<p>–</p>')
  })

  it('a normal bullet is still a list, not a break', () => {
    expect(html('- x')).toBe('<ul>\n  <li>x</li>\n</ul>')
  })

  it('a spaced break interrupts a paragraph and a heading', () => {
    expect(html('para\n- - -')).toBe('<p>para</p>\n<hr>')
    expect(html('# H\n- - -')).toBe('<section id="H">\n  <h1>H</h1>\n  <hr>\n</section>')
  })
})
