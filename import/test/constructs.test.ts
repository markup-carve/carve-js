import { describe, expect, it } from 'vitest'
import { importDocument, type Format } from '../src/index.ts'
import { commonmarkCases, djotCases, gfmCases } from '../scripts/suites.ts'

const constructs = (input: string, from: Format) => importDocument(input, { from, constructs: true }).constructs

describe('preserved-construct records of a hub import (carve-js#5133)', () => {
  it('records a Markdown strong as preserved with its byte range', () => {
    expect(constructs('**Hello**', 'markdown')).toEqual([
      { construct: 'strong', node: 'strong', status: 'preserved', range: { startOffset: 0, endOffset: 9 } },
    ])
  })

  it('counts ranges in UTF-8 bytes of the input', () => {
    expect(constructs('ä **ü**\n', 'gfm')?.[0]?.range).toEqual({ startOffset: 3, endOffset: 9 })
    expect(constructs('ä *ü*\n', 'djot')?.[0]).toEqual(
      { construct: 'strong', node: 'strong', status: 'preserved', range: { startOffset: 3, endOffset: 7 } })
  })

  it('leaves every construct of a type unverified when one of them is lost', () => {
    expect(constructs('[x](javascript:a) [y](z) *e*\n', 'markdown')?.map(entry => [entry.node, entry.status])).toEqual([
      ['link', 'unverified'], ['link', 'unverified'], ['emphasis', 'preserved'],
    ])
    // Emphasis in alternative text and an empty link have no node in the tree.
    expect(constructs('![*a*](i.png)\n', 'markdown')?.map(entry => [entry.node, entry.status]))
      .toEqual([['image', 'preserved'], ['emphasis', 'unverified']])
    expect(constructs('[](u)\n', 'markdown')?.map(entry => entry.status)).toEqual(['unverified'])
  })

  it('records block constructs of all three formats', () => {
    expect(constructs('# H\n\n> q\n\n- a\n\n```js\nx\n```\n', 'markdown')?.map(entry => [entry.construct, entry.node, entry.status]))
      .toEqual([['atxHeading', 'heading', 'preserved'], ['blockQuote', 'block_quote', 'preserved'],
        ['listUnordered', 'list', 'preserved'], ['codeFenced', 'code_block', 'preserved']])
    expect(constructs('| a |\n|---|\n| 1 |\n\n> [!NOTE]\n> hi\n', 'gfm')?.map(entry => [entry.node, entry.status]))
      .toEqual([['table', 'preserved'], ['admonition', 'preserved']])
    expect(constructs('x[^1]\n\n[^1]: n\n', 'djot')?.map(entry => [entry.node, entry.status]))
      .toEqual([['footnote_ref', 'preserved'], ['footnote', 'preserved']])
  })

  it('writes no source position of djot.js into the source', () => {
    expect(importDocument('# H\n\n*a* [b](c)\n', { from: 'djot', constructs: true }).source).toBe('= H\n\n*a* [b](c)\n')
  })

  it('gives in-range, ordered records for every suite example', () => {
    for (const [from, cases] of [['markdown', commonmarkCases()], ['gfm', gfmCases()], ['djot', djotCases()]] as const) {
      for (const { input } of cases) {
        const bytes = Buffer.byteLength(input)
        const records = constructs(input, from) ?? []
        let last = 0
        for (const { range } of records) {
          expect(range.startOffset).toBeGreaterThanOrEqual(last)
          expect(range.endOffset).toBeGreaterThanOrEqual(range.startOffset)
          expect(range.endOffset).toBeLessThanOrEqual(bytes)
          last = range.startOffset
        }
      }
    }
  })

  it('gives records only on request, and none for HTML and BBCode, whose findings carry their own ranges', () => {
    expect(importDocument('**a**', { from: 'markdown' }).constructs).toBeUndefined()
    expect(importDocument('<strong>a</strong>', { from: 'html', constructs: true }).constructs).toBeUndefined()
    expect(importDocument('[b]a[/b]', { from: 'bbcode', constructs: true }).constructs).toBeUndefined()
  })
})
