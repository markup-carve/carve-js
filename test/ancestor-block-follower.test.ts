import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

const cases = JSON.parse(readFileSync(new URL('./fixtures/ancestor-block-follower.json', import.meta.url), 'utf8')) as Array<{
  id: string
  source: string
  html: string
}>

describe('a below-column descendant comment needs an open paragraph', () => {
  it.each(cases)('$id matches the independent native ownership', ({ source, html }) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each(cases.filter(({ id }) => id.startsWith('d3-') && id.endsWith('# h')))('$id leaves heading-shaped text after the outer list', ({ source }) => {
    const document = parse(source)
    const container = document.children[0]!
    const blocks = container.type === 'block_quote' ? container.children : document.children
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.type).toBe('list')
    expect(blocks[1]!.type).toBe('paragraph')
    expect(carveToHtml(source)).not.toContain('<h1>')
  })
})
