import { expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'
import { citations } from '../src/extension/citations.js'

it('keeps reserved reference tails literal in links and images', () => {
  for (const extensions of [[], [citations()]]) {
    for (const source of ['[t][@a]', '![t][@a]', '[][@a]', '![][@a]']) {
      const paragraph = parse(`${source}\n`, { extensions }).children[0]
      if (paragraph.type !== 'paragraph') throw new Error('expected paragraph')
      expect(paragraph.children.map(node => node.type)).toEqual(['text'])
      expect(carveToHtml(`${source}\n`, { extensions })).toBe(`<p>${source}</p>`)
    }
  }
})

it('still recognizes ordinary reference labels and standalone citations', () => {
  const paragraph = parse('[t][a] and ![t][a]\n').children[0]
  if (paragraph.type !== 'paragraph') throw new Error('expected paragraph')
  expect(paragraph.children.map(node => node.type)).toContain('link')
  expect(paragraph.children.map(node => node.type)).toContain('image')
  const citationParagraph = parse('[@a]\n', { extensions: [citations()] }).children[0]
  if (citationParagraph.type !== 'paragraph') throw new Error('expected paragraph')
  expect(citationParagraph.children[0].type).toBe('citation_group')
})
