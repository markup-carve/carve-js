import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToCarve, carveToHtml, fromAstJson, parse, renderCarve } from '../src/index.js'

// carve#5167, CARVE-P12-027: a comment after a term is the first block of the description that follows.
type Wire = { type: string; pos?: { startOffset: number; endOffset: number }; children?: Wire[]; items?: Wire[]; content?: string }

const ast = (source: string): Wire => {
  const json = carveToAstJson(source) as unknown
  return (typeof json === 'string' ? JSON.parse(json) : json) as Wire
}
const span = (node: Wire | undefined): string | undefined => node?.pos ? `${node.pos.startOffset}-${node.pos.endOffset}` : undefined
const shape = (node: Wire): unknown => ({
  type: node.type,
  ...(node.pos ? { pos: span(node) } : {}),
  ...(node.content !== undefined ? { content: node.content } : {}),
  ...(node.children && node.type.startsWith('definition_') ? { children: node.children.map(shape) } : {}),
})

describe('a comment between a term and its description', () => {
  it.each([
    {
      source: ':: t\n  %%%\n      a\n  %%%\n:  body\n',
      written: ':: t\n: %%%\n        a\n  %%%\n\n  body\n',
      list: '0-32',
      items: [
        { type: 'definition_term', pos: '0-4', children: [{ type: 'text', pos: '3-4' }] },
        { type: 'definition_description', pos: '7-32', children: [
          { type: 'comment', pos: '7-24', content: '      a' }, { type: 'paragraph', pos: '28-32' },
        ] },
      ],
    },
    {
      source: ':: t\n%%%\na\n%%%\n: body\n',
      written: ':: t\n: %%%\n  a\n  %%%\n\n  body\n',
      list: '0-21',
      items: [
        { type: 'definition_term', pos: '0-4', children: [{ type: 'text', pos: '3-4' }] },
        { type: 'definition_description', pos: '5-21', children: [
          { type: 'comment', pos: '5-14', content: 'a' }, { type: 'paragraph', pos: '17-21' },
        ] },
      ],
    },
    {
      source: ':: t\n%%%\na\n%%%\n:: u\n: body\n',
      written: ':: t\n:: u\n: %%%\n  a\n  %%%\n\n  body\n',
      list: '0-26',
      items: [
        { type: 'definition_term', pos: '0-4', children: [{ type: 'text', pos: '3-4' }] },
        { type: 'definition_term', pos: '15-19', children: [{ type: 'text', pos: '18-19' }] },
        { type: 'definition_description', children: [
          { type: 'comment', pos: '5-14', content: 'a' }, { type: 'paragraph', pos: '22-26' },
        ] },
      ],
    },
    {
      source: ':: t\n%% c\n: body\n',
      written: ':: t\n: %% c\n\n  body\n',
      list: '0-16',
      items: [
        { type: 'definition_term', pos: '0-4', children: [{ type: 'text', pos: '3-4' }] },
        { type: 'definition_description', pos: '5-16', children: [
          { type: 'comment', pos: '5-9', content: 'c' }, { type: 'paragraph', pos: '12-16' },
        ] },
      ],
    },
    {
      source: ':: t\n%% c\n:: u\n: body\n',
      written: ':: t\n:: u\n: %% c\n\n  body\n',
      list: '0-21',
      items: [
        { type: 'definition_term', pos: '0-4', children: [{ type: 'text', pos: '3-4' }] },
        { type: 'definition_term', pos: '10-14', children: [{ type: 'text', pos: '13-14' }] },
        { type: 'definition_description', children: [
          { type: 'comment', pos: '5-9', content: 'c' }, { type: 'paragraph', pos: '17-21' },
        ] },
      ],
    },
  ])('$source', ({ source, written, list, items }) => {
    const doc = ast(source)
    expect(doc.children).toHaveLength(1)
    expect(span(doc.children![0])).toBe(list)
    expect(doc.children![0]!.items!.map(shape)).toEqual(items)
    expect(carveToCarve(source)).toBe(written)
    expect(carveToCarve(written)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(renderCarve(fromAstJson(carveToAstJson(source)))).toBe(renderCarve(parse(source)))
  })

  it('keeps consecutive comments in source order', () => {
    const source = ':: c\n  %% one\n  %% two\n: def\n'
    const description = ast(source).children![0]!.items![1]!
    expect(description.children!.map((child) => child.content ?? child.type)).toEqual(['one', 'two', 'paragraph'])
    expect(carveToCarve(source)).toBe(':: c\n: %% one\n  %% two\n\n  def\n')
  })

  it('keeps a comment line below a marker-line comment inside the description', () => {
    const source = ':: c\n: %% one\n  %% two\n\n  def\n'
    const description = ast(source).children![0]!.items![1]!
    expect(description.children!.map((child) => child.content ?? child.type)).toEqual(['one', 'two', 'paragraph'])
    expect(carveToCarve(source)).toBe(source)
  })

  it('leaves a comment with the term when no description follows', () => {
    const doc = ast(':: t\n%%%\na\n%%%\n:: u\n')
    const [t, u] = doc.children![0]!.items!
    expect(t!.children!.map((child) => child.type)).toEqual(['text', 'comment'])
    expect(u!.children!.map((child) => child.type)).toEqual(['text'])
  })
})
