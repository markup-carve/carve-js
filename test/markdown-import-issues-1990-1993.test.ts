import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

describe('Markdown import boundary regressions', () => {
  it('keeps the final newline of an unclosed HTML block without adding a blank line', () => {
    expect(markdownToCarve('<script>\nfoo\n')).toBe('```=html\n<script>\nfoo\n```\n')
  })

  it('keeps an item whose only content is an empty-destination definition', () => {
    const imported = markdownToCarve('- [x]: <>\n- b\n')
    expect(imported).toContain('- %%\n- b')
    expect((carveToHtml(imported).match(/<li>/g) ?? [])).toHaveLength(2)
  })

  it('keeps every blank line inside a raw HTML block', () => {
    const imported = markdownToCarve('<pre>\na\n\n\nb\n</pre>\n')
    expect(imported).toContain('<pre>\na\n\n\nb\n</pre>')
    expect(carveToHtml(imported)).toContain('<pre>\na\n\n\nb\n</pre>')
  })

  it('moves a footnote definition to the writer position', () => {
    const imported = markdownToCarve('a[^1]\n\n[^1]: note\n\nb\n')
    expect(imported).toBe('a[^1]\n\nb\n\n[^1]: note\n')
    expect(carveToHtml(imported)).toContain('note')
  })

  it('does not preserve outside blanks after a quoted raw HTML fence', () => {
    const source = '> <pre>\n> a\n> </pre>\n\n\n\nb\n'
    const imported = markdownToCarve(source)
    expect(imported).not.toContain('> ```\n\n\n')
  })

  it('does not treat a raw fence example inside code as a raw block', () => {
    const source = '````\n```=html\n````\n\n\n\nb\n'
    const imported = markdownToCarve(source)
    expect(imported).not.toContain('````\n\n\n')
  })

  it('keeps raw HTML blanks after a code fence in a list item', () => {
    const source = '- ```\n  x\n  ```\n\n<pre>\na\n\n\nb\n</pre>\n'
    const imported = markdownToCarve(source)
    expect(imported).toContain('<pre>\na\n\n\nb\n</pre>')
    expect(carveToHtml(imported)).toContain('<pre>\na\n\n\nb\n</pre>')
  })
})
