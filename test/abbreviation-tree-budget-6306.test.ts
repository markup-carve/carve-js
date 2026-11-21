import { describe, expect, it } from 'vitest'
import { encodeTree, parse, parseTree, render } from '../src/index.ts'

type Abbreviation = { type: 'abbreviation', key: string, namespace: 'abbr', expansion?: string }

function uses(source: string): Abbreviation[] {
  const document = parse(source)
  const paragraph = document.children.find((node) => node.type === 'paragraph')
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph')
  return paragraph.children.filter((node): node is Abbreviation => node.type === 'abbreviation')
}

describe('C2-I-098: copied abbreviation expansions use one parse budget', () => {
  it('CC-1474 fills the budget exactly', () => {
    const source = `*[A]: ${'x'.repeat(99_999)}\n*[C]: ${'z'.repeat(10)}\n\n${'A '.repeat(10)}C\n`
    expect(uses(source).map((node) => node.expansion?.length)).toEqual([...Array<number>(10).fill(99_999), 10])
  })

  it('CC-1475 omits an over-budget copy and still takes a later one that fits', () => {
    const source = `*[A]: ${'x'.repeat(99_999)}\n*[B]: ${'y'.repeat(11)}\n*[C]: ${'z'.repeat(10)}\n\n${'A '.repeat(10)}B C\n`
    const nodes = uses(source)
    expect(nodes.map((node) => [node.key, node.expansion?.length])).toEqual([
      ...Array<[string, number]>(10).fill(['A', 99_999]), ['B', undefined], ['C', 10],
    ])
    expect(nodes[10]).toMatchObject({ type: 'abbreviation', key: 'B', namespace: 'abbr' })
    expect(nodes[10]).not.toHaveProperty('expansion')
    expect(render(source)).toContain('<abbr title="zzzzzzzzzz">C</abbr>')
  })

  it('charges UTF-8 bytes and shares the budget through nested inline flows', () => {
    const source = `*[A]: ${'é'.repeat(60_000)}\n\n${'A '.repeat(7)}*A* A\n`
    // The source is under 125 KB, so the fixed budget permits eight copies of 120,000 bytes.
    const document = parse(source)
    const paragraph = document.children.find((node) => node.type === 'paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph')
    const ordinary = paragraph.children.filter((node): node is Abbreviation => node.type === 'abbreviation')
    const strong = paragraph.children.find((node) => node.type === 'strong')
    expect(ordinary.map((node) => node.expansion !== undefined)).toEqual([true, true, true, true, true, true, true, false])
    expect(strong?.type === 'strong' && strong.children[0]?.type === 'abbreviation' && strong.children[0].expansion).toHaveLength(60_000)
  })

  it('bounds tree JSON for repeated long expansions', () => {
    const n = 2_000
    const source = `*[A]: ${'x'.repeat(2 * n)}\n\n${'A '.repeat(n)}`
    const json = encodeTree(parseTree(source).document)
    expect(json.length).toBeLessThan(2_000_000)
  })
})
