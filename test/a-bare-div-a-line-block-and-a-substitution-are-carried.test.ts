import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToAst, htmlToCarve } from '../src/index.js'

// PART 10 §13a presence carriers for a bare div, a line block and a
// substitution: written under roundtrip export only, read in every import mode.

const types = (html: string): string[] => {
  const out: string[] = []
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) return value.forEach(visit)
    const node = value as Record<string, unknown>
    if (typeof node['type'] === 'string') out.push(node['type'])
    Object.values(node).forEach(visit)
  }
  visit(htmlToAst(html).value.children)
  return out
}

describe('the writer', () => {
  it.each([
    [':::\ninside\n:::\n', '<div data-carve-div>'],
    ['::: |\nfirst\nsecond\n:::\n', '<div data-carve-line-block class="line-block">'],
    ['{#i}\n::: |\na\n:::\n', '<div data-carve-line-block id="i" class="line-block">'],
    ['a {~old~>new~} b\n', '<span data-carve-substitution><del>old</del><ins>new</ins></span>'],
  ])('carries %j under roundtrip export only', (source, carried) => {
    expect(carveToHtml(source, { roundtrip: true })).toContain(carried)
    expect(carveToHtml(source)).not.toContain('data-carve-')
  })

  it('writes no div carrier where the div has another attribute', () => {
    expect(carveToHtml('{.x}\n:::\ninside\n:::\n', { roundtrip: true })).toBe('<div class="x">\n  <p>inside</p>\n</div>')
  })
})

describe('the reader', () => {
  it.each(['safe', 'semantic', 'roundtrip'] as const)('rebuilds each node in %s mode, legacy spelling included', (mode) => {
    expect(htmlToCarve('<div data-carve-div><p>x</p></div>', { mode }).value).toBe(':::\nx\n:::\n')
    expect(htmlToCarve('<div data-djot-div><p>x</p></div>', { mode }).value).toBe(':::\nx\n:::\n')
    expect(htmlToCarve('<div data-carve-line-block class="line-block"><p>a<br>\nb</p></div>', { mode }).value).toBe('::: |\na\nb\n:::\n')
    expect(htmlToCarve('<p><span data-carve-substitution><del>o</del><ins>n</ins></span></p>', { mode }).value).toBe('{~o~>n~}\n')
  })

  it('reads a bare div without the carrier as its content', () => {
    expect(htmlToCarve('<div><p>x</p></div>').value).toBe('x\n')
  })

  it('reads the div carrier over a container class', () => {
    expect(types('<div data-carve-div class="note"><p>x</p></div>')).toContain('div')
  })

  it('never reads a line block from its class alone', () => {
    expect(types('<div class="line-block"><p>a<br>\nb</p></div>')).not.toContain('line_block')
  })

  it.each([
    ['another attribute on the span', '<p><span data-carve-substitution class="x"><del>o</del><ins>n</ins></span></p>'],
    ['text between the halves', '<p><span data-carve-substitution><del>o</del> <ins>n</ins></span></p>'],
    ['the halves reversed', '<p><span data-carve-substitution><ins>n</ins><del>o</del></span></p>'],
    ['an attribute on a half', '<p><span data-carve-substitution><del class="x">o</del><ins>n</ins></span></p>'],
    ['no carrier', '<p><del>o</del><ins>n</ins></p>'],
  ])('reads no substitution with %s', (_, html) => {
    expect(types(html)).not.toContain('substitution')
    expect(htmlToCarve(html).value).not.toContain('data-carve-substitution')
  })
})
