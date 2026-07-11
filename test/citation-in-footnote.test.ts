import { describe, it, expect } from 'vitest'
import { carveToHtml, citations } from '../src/index.js'

describe('citation inside a footnote body', () => {
  it('numbers a citation used only in a footnote body and lists it', () => {
    const src = 'Text[^a].\n\n[^a]: body [@k] here.\n\n[@k]: Ref.\n'
    const out = carveToHtml(src, { extensions: [citations()] })
    expect(out).not.toContain('>undefined<')
    expect(out).toContain('href="#ref-k">1</a>')
    expect(out).toContain('<ol class="references">')
    expect(out).toContain('<li id="ref-k">Ref.</li>')
  })
})
