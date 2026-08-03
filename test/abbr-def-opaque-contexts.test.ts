import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * An abbreviation definition is collected from the document, and the scan that
 * did it knew nothing about what is OPAQUE: it registered `*[A]: x` written
 * inside a fenced code sample, and inside a line block, so documenting the
 * syntax silently changed the prose around it.
 *
 * A link reference definition was already skipped in both places by the walk
 * that tracks fences - abbreviations had a separate scan of their own with no
 * such knowledge (carve#573).
 */
describe('an abbreviation definition inside opaque content', () => {
  it('is not registered from a fenced code sample', () => {
    const html = carveToHtml('A here.\n\n```\n*[A]: x\n```\n')
    expect(html).not.toContain('<abbr')
    expect(html).toContain('<code>*[A]: x')
  })

  it('is not registered from a line block', () => {
    const html = carveToHtml('A here.\n\n::: |\n*[A]: x\n:::\n')
    expect(html).not.toContain('<abbr')
  })

  it('stays literal text inside the verse it was written in', () => {
    const html = carveToHtml('::: |\n*[A]: x\nA here\n:::\n')
    expect(html).not.toContain('<abbr')
    expect(html).toContain('*[A]: x')
  })

  it('is still registered at the top level', () => {
    expect(carveToHtml('*[A]: x\n\nA here.\n')).toContain('<abbr title="x">A</abbr>')
  })

  it('is still registered after a line block closes', () => {
    const html = carveToHtml('::: |\nverse\n:::\n\n*[A]: x\n\nA here.\n')
    expect(html).toContain('<abbr title="x">A</abbr>')
  })

  it('is still registered after a code fence closes', () => {
    const html = carveToHtml('```\nsample\n```\n\n*[A]: x\n\nA here.\n')
    expect(html).toContain('<abbr title="x">A</abbr>')
  })

  it('leaves a wider line-block fence closed only by its own width', () => {
    const html = carveToHtml('A here.\n\n:::: |\n*[A]: x\n:::\nstill verse\n::::\n')
    expect(html).not.toContain('<abbr')
  })
})
