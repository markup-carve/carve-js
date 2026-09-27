import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

// A text `.` that could open `www.` (PART 11 section 8i) is carried to the line
// decision, and M1c must still see it as an ordered-list marker.
describe('an autolink carrier does not hide a list marker', () => {
  it.each([
    ['[1]{.a}[. x]{.b}', '1\\. x'],
    ['[1]{.a}[) x]{.b}', '1\\) x'],
    ['[1]{.a}[.]{.b}', '1\\.'],
    ['see [1]{.a}[. x]{.b}', 'see 1. x'],
    ['[w]{.a}[ww.x.org]{.b}', 'www\\.x.org'],
  ])('%s', (carve, markdown) => {
    expect(carveToMarkdown(`${carve}\n`)).toBe(`${markdown}\n`)
  })
})
