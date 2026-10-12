import { expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve, parse } from '../src/index.js'

function normalize(value: unknown): any {
  if (Array.isArray(value)) {
    const result: any[] = []
    for (const item of value.map(normalize)) {
      const previous = result.at(-1)
      if (item?.type === 'text' && previous?.type === 'text') previous.value += item.value
      else result.push(item)
    }
    return result
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'pos' && key !== 'srcByteLength')
    .map(([key, item]) => [key, key === 'type' && item === 'escaped_text' ? 'text' : normalize(item)]))
}

const tree = (source: string) => normalize(parse(source, { positions: false }))

it.each([
  '[[x]()]{.c}',
  '[[x](u)]{.c}',
  '[a \\[b\\] c]{.c}',
  '[[x]{.c}](u)',
  '[[x]](u){.k}',
  '[[x]()](u){.k}',
  '[a \\[b\\] c](u){.k}',
  '[[x]{.c}](u){.k}',
  '[a [*b*]{.inner} [c](u){.link}]{.outer}',
  '[# heading]{.c}',
  '[- item]{.c}',
])('preserves marked inline bracket scope: %s', (source) => {
  const markdown = carveToMarkdown(source, { roundtrip: true })
  for (const prefix of ['carve', 'djot']) {
    const imported = markdownToCarve(markdown.replaceAll('data-carve-', `data-${prefix}-`))
    expect(tree(imported)).toEqual(tree(source))
    expect(carveToHtml(imported)).toBe(carveToHtml(source))
  }
})
