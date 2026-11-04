import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToCarve, markdownToCarve } from '../src/index.js'

// CARVE-P2-034 (carve#4917): an HTML comment that ends a Markdown list imports
// as `%%` at its own column, followed by the three-blank list boundary.

describe('a Markdown comment that ends a list', () => {
  it('keeps the two lists of CommonMark example 308 apart', () => {
    expect(markdownToCarve('- foo\n- bar\n\n<!-- -->\n\n- baz\n- bim\n')).toBe('- foo\n- bar\n\n%%\n\n\n\n- baz\n- bim\n')
  })

  it('ends a list that has no blank line before the comment', () => {
    expect(markdownToCarve('- a\n<!-- c -->\n- b\n')).toBe('- a\n\n%% c\n\n\n\n- b\n')
  })

  it('restarts the numbering of an ordered list', () => {
    expect(markdownToCarve('1. a\n\n<!-- c -->\n\n1. b\n')).toBe('1. a\n\n%% c\n\n\n\n1. b\n')
  })

  it('ends only the nested list it stands left of', () => {
    expect(markdownToCarve('- x\n  - a\n\n  <!-- c -->\n\n  - b\n- y\n')).toBe('- x\n\n  - a\n\n  %% c\n\n\n\n  - b\n\n- y\n')
  })

  it('ends a list in a quote', () => {
    expect(markdownToCarve('> 1. a\n>\n> <!-- c -->\n>\n> 1. b\n')).toBe('> 1. a\n>\n> %% c\n>\n>\n>\n> 1. b\n')
  })

  it('needs no boundary before a block that is no list (example 309)', () => {
    expect(markdownToCarve('- foo\n\n<!-- -->\n\n    code\n')).toBe('- foo\n\n%%\n\n```\ncode\n```\n')
  })

  it('ends the inner list of a compact `- - a` item', () => {
    expect(markdownToCarve('- - a\n\n  <!-- c -->\n\n  - b\n')).toBe("- - a\n\n  %% c\n\n\n\n  - b\n")
  })

  it('leaves the same lines in fenced code alone', () => {
    expect(markdownToCarve('```\n- a\n<!-- c -->\n- b\n```\n')).toBe('```\n- a\n<!-- c -->\n- b\n```\n')
  })

  it('stays in the item when it sits at the content column', () => {
    expect(carveToHtml(markdownToCarve('- a\n\n  <!-- c -->\n\n- b\n'))).toBe('<ul>\n  <li><p>a</p></li>\n  <li><p>b</p></li>\n</ul>')
  })
})

describe('fmt keeps a list boundary after a comment', () => {
  it.each([
    '- a\n\n%% x\n\n\n\n- b\n',
    '- x\n  - a\n\n  %% c\n\n\n\n  - b\n',
    '> - a\n>\n> %% c\n>\n>\n>\n> - b\n',
  ])('%j', (source) => {
    expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
  })
})
