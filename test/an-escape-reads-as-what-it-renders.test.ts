import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// markup-carve/carve#4511: CARVE-P3-023 R1 and the hyphen-run clause read a
// hard break or an escaped space as the flank character it renders.
describe('a hard break and an escaped space are typography flank', () => {
  it.each([
    ['"a-"\\\nb\n', '<p>“a-”<br>\nb</p>'],
    ['"a-"\\ b\n', '<p>“a-”&nbsp;b</p>'],
    ['"a-"\\', '<p>“a-”<br>\n</p>'],
    ["'a/'\\\nb\n", '<p>‘a/’<br>\nb</p>'],
    ['x --\\\nb\n', '<p>x –<br>\nb</p>'],
    ['x ---\\ y\n', '<p>x —&nbsp;y</p>'],
    ['x --\\.\n', '<p>x --.</p>'],
    ['"a-"\\.\n', '<p>“a-“.</p>'],
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

// markup-carve/carve#4513: an extension's content ends at its first unescaped `]`.
describe('an escaped bracket is extension content', () => {
  it.each([
    [':foo[a\\]b] c\n', '<p><span class="ext-foo">a]b</span> c</p>'],
    [':foo[\\]]\n', '<p><span class="ext-foo">]</span></p>'],
    [':foo[a\\\\]b]\n', '<p><span class="ext-foo">a\\</span>b]</p>'],
    [':foo[a [b] c]\n', '<p><span class="ext-foo">a [b</span> c]</p>'],
  ])('%j', (source, expected) => {
    expect(html(source)).toBe(expected)
  })
})

// markup-carve/carve#4512: an inline note's body holds a run (CARVE-P9-041).
describe('an inline note body opens a run for a trailing comment', () => {
  it('reads a leading %% as a comment that ends at the closing bracket', () => {
    const out = html('^[%% c] d\n')
    expect(out).toContain('<sup>1</sup></a> d</p>')
    expect(out).not.toContain('%%')
    expect(out).toContain('<p><a href="#fnref1" role="doc-backlink"')
  })
})

// markup-carve/carve#4514: on a typed div the directive's classes lead.
describe('a typed div writes its directive classes first', () => {
  it.each([
    ['{k=v .c}\n::: note\nx\n:::\n', '<aside class="admonition note c" k="v" aria-label="Note">'],
    ['{.c}\n::: foo\nx\n:::\n', '<div class="foo c">'],
  ])('%j', (source, opening) => {
    expect(carveToHtml(source)).toContain(opening)
  })
})
