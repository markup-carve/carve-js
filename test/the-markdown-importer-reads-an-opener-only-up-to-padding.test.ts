import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

const corpus = (name: string) => readFileSync(new URL(`../spec/tests/corpus/${name}`, import.meta.url), 'utf8')

const CASE = '487-a-form-feed-or-a-no-break-space-is-content-wherever-whitespace-is-tested-9'

describe('the Markdown importer takes a frontmatter opener only when padding ends the line', () => {
  it.each([
    ['a form feed', '\f'],
    ['a no-break space', ' '],
    ['a vertical tab', '\v'],
  ])('keeps `---yaml` followed by %s as a paragraph, the character included', (_what, ch) => {
    const carve = markdownToCarve(`---yaml${ch}\na: 1\n\n---\n\nt\n`)
    expect(carve).toBe(`\\-\\-\\-yaml${ch}\na: 1\n\n---\n\nt\n`)
  })

  it('renders the form feed case the way the spec corpus does', () => {
    const md = '---yaml\f\na: 1\n\n---\n\nt\n'
    expect(carveToHtml(markdownToCarve(md))).toBe(carveToHtml(corpus(`${CASE}.crv`)))
  })

  it.each([
    ['a spaced typed opener', '--- yaml\na: 1\n---\n\nt\n'],
    ['a clean typed opener', '---yaml\na: 1\n---\n\nt\n'],
    ['a bare opener over a mapping', '---\na: 1\n---\n\nt\n'],
    ['a bare opener with trailing spaces and tabs', '--- \t\na: 1\n---\n\nt\n'],
    ['a typed opener with trailing spaces', '---yaml  \na: 1\n---\n\nt\n'],
  ])('still opens frontmatter on %s', (_what, md) => {
    expect(markdownToCarve(md)).toBe('---yaml\na: 1\n---\n\nt\n')
  })
})
