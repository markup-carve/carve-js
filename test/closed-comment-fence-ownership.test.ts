import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToCarve, carveToHtml, parse, renderHtml } from '../src/index.js'
import controls from './fixtures/closed-comment-fence-ownership.json'

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

const htmlTree = (html: string): unknown => {
  const visit = (node: HtmlNode, literal = false): unknown => {
    if ('value' in node) return !literal && node.value.trim() === '' ? undefined : { text: node.value }
    if ('tagName' in node) {
      literal ||= node.tagName === 'pre' || node.tagName === 'code'
      const attributes = Object.fromEntries(node.attrs
        .filter(attr => !(['ul', 'li', 'input'].includes(node.tagName) && ['class', 'data-task-state', 'aria-label'].includes(attr.name)))
        .map(attr => [attr.name, ['checked', 'disabled'].includes(attr.name) ? true : attr.value])
        .sort(([a], [b]) => String(a).localeCompare(String(b))))
      return { tag: node.tagName, attributes, children: node.childNodes.map(child => visit(child, literal)).filter(child => child !== undefined) }
    }
    return 'childNodes' in node ? node.childNodes.map(child => visit(child, literal)).filter(child => child !== undefined) : undefined
  }
  return visit(parseFragment(html))
}

// Eight known raw-payload discrepancies have code-only controls; the broader audit tracks them.
// Native values were read from layout.mjs and html.mjs at spec efc1e980.
it.each(controls)('keeps closed comment payload out of fence ownership across all render paths: $source', ({ source, codes, html }) => {
  expect(codeValues(carveToHtml(source))).toEqual(codes)
  expect(codeValues(renderHtml(parse(source)))).toEqual(codes)
  expect(codeValues(carveToHtml(carveToCarve(source)))).toEqual(codes)
  if (html !== undefined) {
    for (const output of [carveToHtml(source), renderHtml(parse(source)), carveToHtml(carveToCarve(source))]) {
      expect(htmlTree(output)).toEqual(htmlTree(html))
    }
  }
})
