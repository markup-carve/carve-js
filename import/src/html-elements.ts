// The table "Elements" of spec/0.2/import-html.md (C2-M-056, C2-M-057), `elements` of data/import-html.json.
import { defaultTreeAdapter, serializeOuter, type DefaultTreeAdapterTypes as Html } from 'parse5'
import { CARRIERS, isElement, report, type HtmlContext } from './html-dom.ts'

export type Treatment = 'map' | 'div' | 'span' | 'unwrap' | 'raw' | 'drop'

const TREATMENTS: ReadonlyMap<string, Treatment> = new Map<string, Treatment>([
  ...['acronym', 'bdi', 'bdo', 'big', 'button', 'cite', 'data', 'dfn', 'font', 'label', 'output', 'q', 'samp', 'small', 'tt', 'var']
    .map((name): [string, Treatment] => [name, 'span']),
  ...['address', 'article', 'center', 'details', 'dialog', 'fieldset', 'footer', 'form', 'header', 'hgroup', 'main', 'nav', 'search']
    .map((name): [string, Treatment] => [name, 'div']),
  ...['audio', 'canvas', 'embed', 'iframe', 'map', 'meter', 'noscript', 'object', 'progress', 'script', 'select', 'style', 'svg',
    'template', 'textarea', 'video'].map((name): [string, Treatment] => [name, 'raw']),
  ...['base', 'head', 'link', 'meta', 'param', 'rp', 'source', 'title', 'track', 'wbr'].map((name): [string, Treatment] => [name, 'drop']),
  ...['body', 'html', 'picture'].map((name): [string, Treatment] => [name, 'unwrap']),
  ...['a', 'abbr', 'aside', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em',
    'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'legend', 'li', 'mark',
    'math', 'menu', 'ol', 'p', 'pre', 'rb', 'rt', 'ruby', 's', 'section', 'span', 'strike', 'strong', 'sub', 'summary', 'sup',
    'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul'].map((name): [string, Treatment] => [name, 'map']),
])

/** The treatment of an element; an element with no row is read by the row `*`, a span. */
export function treatment(node: Html.Element): Treatment {
  return TREATMENTS.get(node.tagName) ?? 'span'
}

/** C2-M-011, C2-M-012: the elements whose node is a block; the head elements are dropped wherever they stand. */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'blockquote', 'section', 'div',
  'ul', 'ol', 'menu', 'dl', 'pre', 'table', 'figure', 'aside', 'li', 'dt', 'dd', 'caption', 'figcaption', 'summary', 'legend',
  'html', 'body', 'head', 'title', 'meta', 'link', 'base'])

export function isBlockElement(node: Html.Element): boolean {
  return BLOCK_ELEMENTS.has(node.tagName) || treatment(node) === 'div'
}

/** C2-M-058: the elements whose counterpart needs a parent element; outside it they are read as their children. */
const NEEDS_PARENT: Readonly<Record<string, readonly string[]>> = {
  li: ['ul', 'ol', 'menu'], dt: ['dl', 'div'], dd: ['dl', 'div'], caption: ['table'], figcaption: ['figure'], summary: ['details'],
  legend: ['fieldset'],
}

function parentElement(node: Html.Element): Html.Element | undefined {
  const parent = node.parentNode
  return parent !== null && defaultTreeAdapter.isElementNode(parent) ? parent : undefined
}

export function isOrphan(node: Html.Element): boolean {
  const parents = NEEDS_PARENT[node.tagName]
  if (parents === undefined) return false
  const parent = parentElement(node)
  if (parent === undefined || !parents.includes(parent.tagName)) return true
  // C2-M-036: a term or description stands in a `<dl>` or in a `<div>` group of one.
  return parent.tagName === 'div' && parentElement(parent)?.tagName !== 'dl'
}

/** C2-M-065, C2-M-067: the outer HTML of a comment or raw element, without the reserved names. */
export function rawValue(node: Html.ChildNode): string {
  if (isElement(node)) node.attrs = node.attrs.filter(entry => !CARRIERS.has(entry.name))
  return serializeOuter(node)
}

/** C2-M-066: with `rawHtml` off, a comment, a raw element or a raw span is dropped with its content, and reported. */
export function keepsRaw(node: Html.ChildNode, context: HtmlContext): boolean {
  if (context.rawHtml === true) return true
  report(context, node, 'import-element-dropped', 'Raw content dropped with rawHtml off')
  return false
}

/** C2-M-057: an element of the treatment `drop` is reported unless its row says otherwise. */
export function dropElement(node: Html.Element, context: HtmlContext): [] {
  if (node.tagName !== 'rp') report(context, node, 'import-element-dropped', `HTML ${node.tagName} dropped`)
  return []
}
