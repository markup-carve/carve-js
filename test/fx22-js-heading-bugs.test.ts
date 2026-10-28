import { describe, expect, it } from 'vitest'
import type { BlockNode } from '../src/ast.js'
import { reachableFootnoteLabels } from '../src/heading/footnote-numbering.js'
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

  it('skips the footnote walk when a deep document has no definitions', () => {
    let block: BlockNode = { type: 'paragraph', children: [{ type: 'text', value: 'x' }] }
    for (let depth = 0; depth < 232; depth++) block = { type: 'div', children: [block] }
    expect(reachableFootnoteLabels({ type: 'document', children: [block], footnoteDefs: {} })).toEqual(new Set())
  })
})
