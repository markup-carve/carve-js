import { describe, expect, it } from 'vitest'
import { carveToMarkdown, migrateMarkdown, parse } from '../src/index.js'
import type { InlineNode } from '../src/ast.js'

const codes = (source: string): Array<[string, string]> => {
  const out: Array<[string, string]> = []
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (value === null || typeof value !== 'object') return
    const node = value as InlineNode
    if (node.type === 'code') out.push(['code', node.value])
    else if (node.type === 'raw_inline') out.push(['raw_inline', node.content])
    else Object.values(node).forEach(walk)
  }
  walk(parse(source).children)
  return out
}

const fallbacks = (markdown: string): number =>
  migrateMarkdown(markdown).report.diagnostics.filter(row => row.code === 'raw-code-fallback').length

describe('an HTML code element the Carve source can spell imports as code', () => {
  it.each([
    ['x{\\*`a*} and `b<code></code>\n', [['code', 'a*} and '], ['code', '']]],
    ['p <code>a<!---->&#10;<!---->b</code> q\n', [['code', 'a\nb']]],
    ['Text\n<code><!---->&#10;<!---->code</code>\n', [['code', '\ncode']]],
    ['a <code>b<!---->&#10;<!---->c&#32;d</code>\n', [['code', 'b\nc d']]],
    ['> <code>a<!---->&#10;<!---->b</code>\n', [['code', 'a\nb']]],
    ['- <code>a<!---->&#10;<!---->b</code>\n', [['code', 'a\nb']]],
  ])('%j', (markdown, expected) => {
    expect(codes(migrateMarkdown(markdown).value)).toEqual(expected)
    expect(fallbacks(markdown)).toBe(0)
  })

  it.each([
    'x{*`a*} and `b`\n',
    'p `a\nb` q\n',
    'Text\n```\ncode\n',
  ])('round-trips %j through the Markdown target', source => {
    const back = migrateMarkdown(carveToMarkdown(source, { roundtrip: true })).value
    expect(codes(back)).toEqual(codes(source))
  })

  // No Carve spelling exists here, so the raw HTML stays and the loss is reported.
  it.each([
    ['~~<code></code>~~\n', 'raw_inline'],
    ['<code></code> z\n', 'raw_inline'],
    ['a <code>b<!---->&#10;<!----><!---->&#10;<!---->c</code>\n', 'raw_inline'],
  ])('keeps %j as raw HTML with a loss', (markdown, kind) => {
    expect(codes(migrateMarkdown(markdown).value).map(([type]) => type)).toEqual([kind])
    expect(fallbacks(markdown)).toBe(1)
  })
})
