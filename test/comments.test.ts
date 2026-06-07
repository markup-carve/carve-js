import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('trailing line comments', () => {
  it('strips a trailing comment, keeps the visible prefix', () => {
    expect(carveToHtml('Also visible. %% gone').trim()).toBe('<p>Also visible.</p>')
  })

  it('leaves %% literal without a preceding space', () => {
    expect(carveToHtml('50%% off and a%%b').trim()).toBe('<p>50%% off and a%%b</p>')
  })

  it('protects %% inside a code span', () => {
    expect(carveToHtml('Run `a %% b` then done. %% gone').trim())
      .toBe('<p>Run <code>a %% b</code> then done.</p>')
  })

  it('keeps \\%% literal', () => {
    expect(carveToHtml('path 50\\%% done').trim()).toBe('<p>path 50%% done</p>')
  })

  it('works in a heading without affecting the id', () => {
    // The id lives on the <section> wrapper (PART 9 §13); the comment is stripped.
    const html = carveToHtml('# Title %% note').trim()
    expect(html).toContain('<section id="title">')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).not.toContain('note')
  })

  it('ends at the line break, keeping the next paragraph line', () => {
    expect(carveToHtml('foo %% note\nbar').trim()).toBe('<p>foo\nbar</p>')
  })

  it('recognizes a comment at the start of an inline run (i===0 path)', () => {
    // Heading text "%% all" reaches scanInline at offset 0, so the inline
    // i===0 guard fires and the whole title is a comment.
    expect(carveToHtml('# %% all').trim()).toBe('<section id="s">\n  <h1></h1>\n</section>')
  })
})
