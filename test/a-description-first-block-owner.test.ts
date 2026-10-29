import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

const corpus = (name: string) => ({
  source: readFileSync(new URL(`../spec/tests/corpus/${name}.crv`, import.meta.url), 'utf8'),
  html: readFileSync(new URL(`../spec/tests/corpus/${name}.html`, import.meta.url), 'utf8'),
})

/**
 * A description's `- +` first block takes a follower only from the body column.
 * Rule A moves a follower owned by the description or by the document onto
 * their column, so the pull must read the authored column, not the moved one.
 */
describe('a description-hosted first block', () => {
  const left = corpus('757-an-intervening-column-refuses-a-description-hosted-first-block')
  const band = corpus('760-a-heading-inside-the-intervening-band-stays-description-text')

  it('leaves a follower that rule A moved out of the description', () => {
    expect(carveToHtml(left.source).trim()).toBe(left.html.trim())
  })

  it('opens a heading in the intervening band as description content', () => {
    expect(carveToHtml(band.source).trim()).toBe(band.html.trim())
  })

  it('reads the moved follower at its source position', () => {
    const doc = carveToAstJson(left.source) as any
    const heading = doc.children[1]
    expect(heading.type).toBe('heading')
    expect([heading.pos.startLine, heading.pos.startColumn, heading.pos.startOffset]).toEqual([3, 2, 12])
    const dd = (carveToAstJson(band.source) as any).children[0].items[1].children
    expect(dd[1].type).toBe('heading')
    expect([dd[1].pos.startLine, dd[1].pos.startColumn, dd[1].pos.startOffset]).toEqual([3, 4, 14])
  })
})
