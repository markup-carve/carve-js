import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const cases = JSON.parse(readFileSync(new URL('./fixtures/descendant-comment-ancestor.json', import.meta.url), 'utf8')) as Array<{
  id: string
  source: string
  html: string
}>

describe('descendant comments retain the enclosing item at a positive dedent', () => {
  it.each(['x', '# h'])('an at-column comment releases %s text below the outer column', (text) => {
    const document = parse(`- a\n  - b\n    %% c\n ${text}\ny\n`)
    expect(document.children.map(({ type }) => type)).toEqual(['list', 'paragraph'])
    const list = document.children[0]!
    if (list.type !== 'list') throw new Error('expected outer list')
    expect(list.items[0]!.children.at(-1)?.type).toBe('list')
  })

  it.each(cases)('$id matches the independent native ownership', ({ source, html }) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each(cases.filter(({ id }) => id.startsWith('comment-target-') && id.endsWith('# h')))('$id keeps the heading-shaped text in the outer item', ({ id, source }) => {
    const document = parse(source)
    expect(document.children).toHaveLength(id === 'comment-target-d2-false-# h' ? 2 : 1)
    const container = document.children[0]!
    const list = container.type === 'block_quote' ? container.children[0]! : container
    expect(list.type).toBe('list')
    if (list.type !== 'list') throw new Error('expected outer list')
    expect(list.items).toHaveLength(1)
    expect(list.items[0]!.children.at(-1)?.type).toBe(id.startsWith('comment-target-d2-') ? 'list' : 'paragraph')
    expect(carveToHtml(source)).not.toContain('<h1>')
  })
})
