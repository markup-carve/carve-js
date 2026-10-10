import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToCarve, carveToHtml, parse, renderHtml } from '../src/index.js'
import controls from './fixtures/nested-fence-ownership.json'

type HtmlNode = DefaultTreeAdapterMap['node']

const text = (node: HtmlNode): string => {
  if ('value' in node) return node.value
  return 'childNodes' in node ? node.childNodes.map(text).join('') : ''
}

const codeValues = (html: string): Array<{ pre: boolean; value: string }> => {
  const values: Array<{ pre: boolean; value: string }> = []
  const visit = (node: HtmlNode, pre = false): void => {
    pre ||= 'tagName' in node && node.tagName === 'pre'
    if ('tagName' in node && node.tagName === 'code') values.push({ pre, value: text(node) })
    if ('childNodes' in node) for (const child of node.childNodes) visit(child, pre)
  }
  visit(parseFragment(html))
  return values
}

// Native values were read from layout.mjs and html.mjs at spec b738ffe7.
it.each(controls)('keeps nested fence ownership across all render paths: $source', ({ source, codes }) => {
  expect(codeValues(carveToHtml(source))).toEqual(codes)
  expect(codeValues(renderHtml(parse(source)))).toEqual(codes)
  expect(codeValues(carveToHtml(carveToCarve(source)))).toEqual(codes)
})
