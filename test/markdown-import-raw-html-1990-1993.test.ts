import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

describe('Markdown import raw HTML block boundaries', () => {
  // markup-carve/carve-js#1990
  it('does not take the final newline of an unclosed HTML block in as a blank line', () => {
    const imported = markdownToCarve('<script>\nfoo\n')
    expect(imported).toBe('```=html\n<script>\nfoo\n```\n')
    expect(carveToHtml(imported)).toBe('<script>\nfoo')
  })

  it.each(['script', 'pre', 'style', 'textarea'])(
    'closes an unclosed <%s> where the source ends',
    (tag) => {
      expect(markdownToCarve(`<${tag}>\nfoo\n`)).toBe(`\`\`\`=html\n<${tag}>\nfoo\n\`\`\`\n`)
    },
  )

  it('keeps a blank line the source really ends with', () => {
    expect(markdownToCarve('<pre>\na\n\n')).toBe('```=html\n<pre>\na\n\n```\n')
  })

  it('leaves a source with no final newline without one', () => {
    expect(markdownToCarve('<script>\nfoo')).toBe('```=html\n<script>\nfoo\n```')
  })

  // markup-carve/carve-js#1993
  it('keeps a run of blank lines inside a raw HTML block', () => {
    const imported = markdownToCarve('<pre>\na\n\n\nb\n</pre>\n')
    expect(imported).toBe('```=html\n<pre>\na\n\n\nb\n</pre>\n```\n')
    expect(carveToHtml(imported)).toBe('<pre>\na\n\n\nb\n</pre>')
  })

  it('keeps a run of blank lines inside a code block', () => {
    expect(markdownToCarve('```\na\n\n\nb\n```\n')).toBe('```\na\n\n\nb\n```\n')
    expect(markdownToCarve('    a\n\n\n    b\n')).toBe('```\na\n\n\nb\n```\n')
  })

  it('still collapses a blank run between two blocks', () => {
    expect(markdownToCarve('a\n\n\n\nb\n')).toBe('a\n\nb\n')
    expect(markdownToCarve('```\na\n```\n\n\n\nb\n')).toBe('```\na\n```\n\nb\n')
  })

  it.each([
    '<script>\nfoo\n',
    '<pre>\na\n\n\nb\n</pre>\n',
    '<pre>\na\n\n',
    '```\na\n\n\nb\n```\n',
  ])('imports %j as a carve fmt fixed point', (source) => {
    const imported = markdownToCarve(source)
    expect(carveToCarve(imported)).toBe(imported)
  })
})
