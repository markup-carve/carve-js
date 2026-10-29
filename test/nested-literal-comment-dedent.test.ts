import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const cases = JSON.parse(readFileSync(new URL('./fixtures/nested-literal-comment-dedent.json', import.meta.url), 'utf8')) as Array<{
  id: string
  source: string
  html: string
}>

const repaired = new Set(['dedent-34', 'dedent-35', 'dedent-42', 'dedent-43'])

describe('nested literal comments release payload to the enclosing item', () => {
  it.each(cases)('$id retains the native ownership', ({ source, html }) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each(cases.filter(({ id }) => repaired.has(id)))('$id releases the payload after an at-column literal comment', ({ source }) => {
    const document = parse(source)
    expect(document.children).toHaveLength(source.startsWith('>') ? 1 : 4)
    const container = document.children[0]!
    expect(container.type).toBe(source.startsWith('>') ? 'block_quote' : 'list')
    const siblings = container.type === 'block_quote' ? container.children : document.children
    expect(siblings.map(({ type }) => type)).toEqual(['list', 'paragraph', 'comment', 'div'])
    const list = container.type === 'block_quote' ? container.children[0]! : container
    expect(list.type).toBe('list')
    if (list.type !== 'list') throw new Error('expected outer list')
    expect(list.items).toHaveLength(1)
    expect(list.items[0]!.children.map(({ type }) => type)).toEqual(['paragraph', 'list'])
  })
})
