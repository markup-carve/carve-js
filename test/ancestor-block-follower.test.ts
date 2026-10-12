import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const cases = JSON.parse(readFileSync(new URL('./fixtures/ancestor-block-follower.json', import.meta.url), 'utf8')) as Array<{
  id: string
  source: string
  html: string
}>

describe('an invisible descendant comment retains the surviving ancestor item', () => {
  it.each(cases)('$id matches the independent native ownership', ({ source, html }) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each(cases.filter(({ id }) => id.startsWith('d3-') && id.endsWith('# h')))('$id retains a literal heading in the outer item', ({ source }) => {
    const document = parse(source)
    expect(document.children).toHaveLength(1)
    const container = document.children[0]!
    const list = container.type === 'block_quote' ? container.children[0]! : container
    expect(list.type).toBe('list')
    if (list.type !== 'list') throw new Error('expected outer list')
    expect(list.items).toHaveLength(1)
    expect(list.items[0]!.children.at(-1)?.type).toBe('paragraph')
    expect(carveToHtml(source)).not.toContain('<h1>')
  })
})
