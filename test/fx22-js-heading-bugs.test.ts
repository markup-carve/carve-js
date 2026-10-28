import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('footnote heading targets', () => {
  it('indexes a note heading only when its definition renders', () => {
    for (const ref of ['[H][]', '</#H>']) {
      const unused = carveToHtml(`[^n]: # H\n\n${ref}\n`)
      expect(unused).not.toContain('href="#H"')
      expect(unused).not.toContain('id="H"')
      const used = carveToHtml(`see[^n]\n\n[^n]: # H\n\n${ref}\n`)
      expect(used).toContain('href="#H"')
      expect(used).toContain('id="H"')
    }
  })
})
