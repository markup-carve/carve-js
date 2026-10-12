import { expect, it } from 'vitest'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { carveToHtml, parse, renderHtml } from '../src/index.js'
import controls from './fixtures/folded-colon-code-closers.json'

const htmlTree = (html: string): unknown => {
  const visit = (node: DefaultTreeAdapterMap['node'], literal = false): unknown => {
    if ('value' in node) return !literal && node.value.trim() === '' ? undefined : { text: node.value }
    if ('tagName' in node) {
      literal ||= node.tagName === 'pre' || node.tagName === 'code'
      return {
        tag: node.tagName,
        attributes: Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value])),
        children: node.childNodes.map(child => visit(child, literal)).filter(child => child !== undefined),
      }
    }
    return 'childNodes' in node ? node.childNodes.map(child => visit(child, literal)).filter(child => child !== undefined) : undefined
  }
  return visit(parseFragment(html))
}

// Native HTML comes from spec 2d473af7.
it.each(controls)('keeps code and trailing paragraphs in their authored hosts: $id', control => {
  expect(htmlTree(carveToHtml(control.source))).toEqual(htmlTree(control.html))
  for (const positions of [false, true]) {
    expect(htmlTree(renderHtml(parse(control.source, { positions })))).toEqual(htmlTree(control.html))
  }
})
