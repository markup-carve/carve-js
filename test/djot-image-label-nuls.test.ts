import { expect, test } from 'vitest'
import { parseFragment } from 'parse5'
import { carveToHtml, djotToCarve } from '../src/index.js'
import { djotToCarveWithLosses } from '../src/djot-import.js'
import controls from './fixtures/djot-image-label-nuls.json'

function images(html: string): unknown[] {
  type HtmlNode = import('parse5').DefaultTreeAdapterMap['node']
  const result: unknown[] = []
  const nodes: HtmlNode[] = [parseFragment(html)]
  while (nodes.length) {
    const node = nodes.pop()!
    if (node.nodeName === 'img' && 'attrs' in node)
      result.push(node.attrs.map(attr => [attr.name, attr.value]).sort())
    if ('childNodes' in node) for (const child of [...node.childNodes].reverse()) nodes.push(child)
  }
  return result
}

test('image labels restore source NULs before nested child text is parsed', () => {
  const failures = []
  for (const { source, html } of controls) {
    const report = djotToCarveWithLosses(source)
    expect(report.losses.some(item => item.message === 'An unresolved Djot image reference has no src; Carve cannot spell that image.'), source).toBe(false)
    const converted = djotToCarve(source)
    const actual = images(carveToHtml(converted))
    const expected = images(html)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push({ source, converted, actual, expected })
  }
  expect(failures).toEqual([])
})
