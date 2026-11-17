// Clauses of freeze candidate 6 (068552fc) that its examples and clause cases leave open.
import { describe, expect, it } from 'vitest'
import { parse, render, write } from '../src/index.ts'

function withoutPositions(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, field: unknown) => (key === 'pos' ? undefined : field))) as unknown
}

describe('freeze candidate 6', () => {
  it('C2-B-109: a `> %%%` line does not close a comment block opened outside the quote', () => {
    expect(withoutPositions(parse('%%%\na\n> %%%\nb\n%%%\nc').children)).toEqual([
      { type: 'comment', form: 'block', value: 'a\n> %%%\nb' },
      { type: 'paragraph', children: [{ type: 'text', value: 'c' }] },
    ])
  })

  it('C2-H-096: the panel letters run from a to z, then aa', () => {
    const panels = Array.from({ length: 27 }, (_, at) => `{#p${at}}\n![${at}](${at}.png)\n^ ${at}`).join('\n\n')
    const html = render(`{#g}\n::: figure\n${panels}\n:::\n^ Figure #: G\n\nSee </#p25> and </#p26>.`)
    expect(html).toContain('<a href="#p25">Figure 1z</a> and <a href="#p26">Figure 1aa</a>')
  })

  it('C2-W-136: body header rows are written without marks and counted in body-header-rows', () => {
    const source = '{body-rows=1,1 body-header-rows=0,1}\n|= H |\n| a |\n| x |\n| b |\n'
    const written = write(parse(source))
    expect(written).toBe(source)
    expect(withoutPositions(parse(written))).toEqual(withoutPositions(parse(source)))
  })

  it('C2-W-136: a body with row header columns and an empty body read back', () => {
    for (const source of ['{body-rows=1,1 body-header-cols=,1}\n| a | b |\n| c | d |\n', '{body-rows=0,1}\n| a |\n']) {
      expect(withoutPositions(parse(write(parse(source))))).toEqual(withoutPositions(parse(source)))
    }
  })

  it('C2-W-097: a bracket right behind `[^` in alt text keeps its backslash', () => {
    for (const source of ['![[^\\]]]()\n', '![a[^\\]]]()\n']) expect(write(parse(source))).toBe(source)
  })

  it('C2-B-230: an entry that is no decimal number leaves all three keys in attrs', () => {
    const table = parse('{body-rows=1,x body-header-cols=1,}\n| a |\n| b |').children[0]
    expect(table?.type === 'table' ? table.attrs?.keyValues : undefined).toEqual([['body-rows', '1,x'], ['body-header-cols', '1,']])
  })
})
