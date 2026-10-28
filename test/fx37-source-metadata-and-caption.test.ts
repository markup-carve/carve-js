import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml } from '../src/index.js'

describe('source metadata and promoted captions', () => {
  it('keeps positional column metadata within the table width', () => {
    for (const [key, value] of [['aligns', 'left,right'], ['valigns', 'top,bottom'], ['widths', '50,50']]) {
      const table = carveToAstJson(`{${key}=${value}}\n| a |\n`).children[0]
      expect(table?.type).toBe('table')
      if (table?.type === 'table') expect(table.columns).toHaveLength(1)
    }
  })

  it('renders invalid source partitions as one body group', () => {
    for (const attr of ['footer-rows=>', 'header-rows=two', 'header-rows=2']) {
      expect(carveToHtml(`{${attr}}\n|= A |\n`)).toContain('<tbody>\n    <tr><th scope="row">A</th></tr>\n  </tbody>')
    }
    expect(carveToHtml('{header-rows=1}\n|= A |\n')).toContain('<thead>')
  })

  it('numbers a caption promoted after a multiline image label', () => {
    const source = '![a\nb](c)\n^ Figure #: sample\n'
    expect(carveToHtml(source)).toContain('<figcaption>Figure 1: sample</figcaption>')
    const figure = carveToAstJson(source).children[0]
    expect(figure?.type).toBe('figure')
    if (figure?.type === 'figure') expect(figure.caption?.find(node => node.type === 'caption_number')).toMatchObject({ n: 1 })
  })

  it('publishes malformed multiline reference labels as literal text and a break', () => {
    for (const source of ['[a][b\nc]', '![a][b\nc]']) {
      const paragraph = carveToAstJson(source).children[0]
      expect(paragraph?.type).toBe('paragraph')
      if (paragraph?.type === 'paragraph') expect(paragraph.children.map(node => node.type)).toEqual(['text', 'soft_break', 'text'])
    }
  })
})
