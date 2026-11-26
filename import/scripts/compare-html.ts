// The HTML comparison of the conformance measurements: parse5 normal form, visible text and block structure.
import { defaultTreeAdapter, parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5'

export type HtmlVerdict = 'same' | 'same-text' | 'different'
const blockTags = ['p', 'pre', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'section']

function canonicalNode(node: Html.ChildNode, blocksOnly: boolean): string {
  if (defaultTreeAdapter.isTextNode(node)) return blocksOnly || !node.value.trim() ? '' : JSON.stringify(node.value)
  if (defaultTreeAdapter.isCommentNode(node)) return blocksOnly ? '' : `<!--${node.data}-->`
  if (!defaultTreeAdapter.isElementNode(node)) return ''
  const children = node.childNodes.map(child => canonicalNode(child, blocksOnly)).join('')
  if (node.tagName === 'section') return children
  if (blocksOnly && !blockTags.includes(node.tagName)) return children
  const attrs = blocksOnly ? '' : node.attrs.filter(attr => !(attr.name === 'id' && node.tagName.startsWith('h')))
    .map(attr => `${attr.name}=${JSON.stringify(attr.value)}`).sort().join(' ')
  return `<${node.tagName}${attrs ? ` ${attrs}` : ''}>${children}</${node.tagName}>`
}

export function canonicalHtml(html: string, blocksOnly = false): string {
  return parseFragment(html).childNodes.map(node => canonicalNode(node, blocksOnly)).join('')
}

export function visibleText(html: string): string {
  const walk = (node: Html.ChildNode): string => {
    if (defaultTreeAdapter.isTextNode(node)) return node.value
    if (!defaultTreeAdapter.isElementNode(node) || ['script', 'style'].includes(node.tagName)) return ''
    return node.childNodes.map(walk).join('')
  }
  return parseFragment(html).childNodes.map(walk).join('').replace(/\s+/gu, ' ').trim()
}

export function verdict(expected: string, actual: string): HtmlVerdict {
  if (canonicalHtml(expected) === canonicalHtml(actual)) return 'same'
  if (visibleText(expected) === visibleText(actual) && canonicalHtml(expected, true) === canonicalHtml(actual, true)) {
    return 'same-text'
  }
  return 'different'
}

