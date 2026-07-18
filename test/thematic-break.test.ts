import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('thematic break', () => {
  it('is a col-0 run of 3+ contiguous identical -, *, or _', () => {
    for (const s of ['---', '***', '___', '----', '*****']) {
      expect(html(s)).toBe('<hr>')
    }
  })

  it('allows only trailing whitespace after the run', () => {
    expect(html('*** ')).toBe('<hr>')
    expect(html('***\t')).toBe('<hr>')
    expect(html('---   ')).toBe('<hr>')
  })

  it('rejects internal spaces — a spaced form is NOT a break', () => {
    // `* * *` / `- - -` are (nested) lists, `_ _ _` is a paragraph (grammar §262).
    expect(html('* * *')).toBe('<ul>\n  <li>\n    <ul>\n      <li>*</li>\n    </ul>\n  </li>\n</ul>')
    expect(html('- - -')).toBe('<ul>\n  <li>\n    <ul>\n      <li>-</li>\n    </ul>\n  </li>\n</ul>')
    expect(html('_ _ _')).toBe('<p>_ _ _</p>')
  })

  it('rejects a leading indent — a break is col-0 only', () => {
    expect(html(' ***')).toBe('<p>***</p>')
    expect(html('  ---')).toBe('<p>—</p>')
    expect(html('\t***')).toBe('<p>***</p>')
  })

  it('does not match a mixed run or fewer than three', () => {
    expect(html('-*-')).toBe('<p>-*-</p>')
    // two dashes is not a break; `--` is smart-typography en-dash
    expect(html('--')).toBe('<p>–</p>')
  })

  it('a normal bullet is still a list, not a break', () => {
    expect(html('- x')).toBe('<ul>\n  <li>x</li>\n</ul>')
  })

  it('a contiguous break interrupts a paragraph and a heading', () => {
    expect(html('para\n***')).toBe('<p>para</p>\n<hr>')
    expect(html('# H\n***')).toBe('<section id="H">\n  <h1>H</h1>\n  <hr>\n</section>')
  })
})
