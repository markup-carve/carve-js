import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { writtenReadsBackAs } from '../src/render-carve.js'

// PART 11 §6 (carve#4973): every break is written `***`. The readback check
// that guards sources holding `%%`, `]:` or `+` must not count the dropped
// marker as a tree change, or fmt returns the whole document verbatim.
describe('fmt writes a canonical break next to a readback trigger', () => {
  const triggers = [
    ['a line comment', '%% c\n\n'],
    ['a trailing line comment', 'x %% c\n\n'],
    ['a reference definition', '[r]: /u\n\n'],
    ['a literal plus', 'a + b\n\n'],
  ] as const
  const breaks = ['---', '- - -', '___', '* * *', '*****', '  ---']

  for (const [name, lead] of triggers) {
    for (const rule of breaks) {
      it(`${name} before ${JSON.stringify(rule)}`, () => {
        const src = `${lead}${rule}\n\nend\n`
        const once = carveToCarve(src)
        expect(once.split('\n')).toContain('***')
        expect(once).not.toContain(rule.trim() === '***' ? '\u0000' : rule.trim())
        expect(carveToCarve(once)).toBe(once)
        expect(carveToHtml(once)).toBe(carveToHtml(src))
      })
    }
  }

  it('still canonicalizes the rest of the document', () => {
    const src = '%% note\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- - -\n'
    const once = carveToCarve(src)
    expect(once).not.toContain('|---|')
    expect(once).toContain('***')
    expect(carveToHtml(once)).toBe(carveToHtml(src))
  })

  it('in a quote and a list item', () => {
    for (const src of ['> %% c\n>\n> - - -\n', '- a\n\n  %% c\n\n  ___\n']) {
      const once = carveToCarve(src)
      expect(once).toMatch(/\*\*\*/)
      expect(carveToCarve(once)).toBe(once)
      expect(carveToHtml(once)).toBe(carveToHtml(src))
    }
  })

  it('still compares a marker attribute that names the break type', () => {
    expect(writtenReadsBackAs('{type=thematic_break marker=a}\np\n', '{type=thematic_break marker=b}\np\n')).toBe(false)
  })
})
