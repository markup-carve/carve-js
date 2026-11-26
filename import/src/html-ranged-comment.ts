// C2-M-113: a ranged comment, the `comment-start` and `comment-end` spans Pandoc writes for a word processor comment.
import { type DefaultTreeAdapterTypes as Html } from 'parse5'
import { type Inline } from '../../src/index.ts'
import {
  attr, attrs, classList, isComment, isElement, isText, plain, renamedKeys, report, withoutClasses, withoutKeys,
  type HtmlContext,
} from './html-dom.ts'
import { treatment } from './html-elements.ts'

const RANGED_KEYS = { 'data-author': 'author', 'data-date': 'datetime' }

// C2-M-069: the inline containers an import drops when they hold nothing and have no attributes.
const EMPTY_DROPPED = new Set(['span', 'a', 'em', 'i', 'strong', 'b', 's', 'strike', 'del', 'ins', 'mark', 'u', 'sub', 'sup'])

interface DocumentIndex {
  /** Each node's place in document order, and the last place of its descendants. */
  order: Map<Html.Node, [number, number]>
  /** The `comment-end` spans by `data-comment-id`, in document order. */
  ends: Map<string, [number, Html.Element][]>
  /** For each place, the number of nodes before it that give an inline. */
  holding: number[]
  /** The ends a comment read before them has claimed. */
  claimed: Set<Html.Element>
}

const INDEXES = new WeakMap<HtmlContext, DocumentIndex>()

function isRangeEndSpan(node: Html.Node): node is Html.Element {
  return isElement(node as Html.ChildNode) && (node as Html.Element).tagName === 'span' &&
    classList(node as Html.Element)[0] === 'comment-end'
}

function isRangeStart(node: Html.Element): boolean {
  return node.tagName === 'span' && classList(node)[0] === 'comment-start'
}

// C2-M-066: the inline reader reads any `<input>` as raw; a task box is taken by its item first.
function isRaw(node: Html.Element): boolean {
  return treatment(node) === 'raw' || node.tagName === 'input'
}

/** An element whose content gives no inline of its own: it is dropped, kept whole as raw, or a comment's text. */
function isOpaque(node: Html.Node): boolean {
  if (!isElement(node as Html.ChildNode)) return false
  const element = node as Html.Element
  return treatment(element) === 'drop' || isRaw(element) || isRangeStart(element)
}

/** Whether a node gives an inline by itself: text, a comment or raw element kept, a comment, or an empty element the import keeps. */
function holds(node: Html.Node, context: HtmlContext): boolean {
  const child = node as Html.ChildNode
  if (isText(child)) return child.value !== ''
  if (isComment(child)) return context.rawHtml === true
  if (!isElement(child)) return false
  if (treatment(child) === 'drop') return false
  if (isRaw(child)) return context.rawHtml === true
  if (isRangeStart(child)) return plain(child) !== ''
  if (child.childNodes.length > 0) return false
  return child.attrs.length > 0 || !EMPTY_DROPPED.has(child.tagName)
}

function documentRoot(node: Html.Node): Html.Node {
  let root = node
  while ('parentNode' in root && root.parentNode !== null) root = root.parentNode
  return root
}

/** Places `at` at `count` in document order. A start's end is the first later end of its id, which is dropped with it. */
function visit(index: DocumentIndex, pending: Set<string>, at: Html.Node, count: number, context: HtmlContext): void {
  index.order.set(at, [count, count])
  const end = isRangeEndSpan(at)
  const claimed = end && pending.delete(attr(at, 'data-comment-id') ?? '\0')
  if (claimed) index.claimed.add(at)
  index.holding.push(index.holding[count]! + (!claimed && holds(at, context) ? 1 : 0))
  if (isElement(at as Html.ChildNode) && isRangeStart(at as Html.Element)) pending.add(attr(at as Html.Element, 'data-comment-id') ?? '\0')
  if (!end) return
  const id = attr(at, 'data-comment-id') ?? '\0'
  const list = index.ends.get(id)
  if (list === undefined) index.ends.set(id, [[count, at]])
  else list.push([count, at])
}

/** One walk of the document, shared by every ranged comment of one import. */
function documentIndex(node: Html.Element, context: HtmlContext): DocumentIndex {
  const known = INDEXES.get(context)
  if (known !== undefined && known.order.has(node)) return known
  const index: DocumentIndex = { order: new Map(), ends: new Map(), holding: [0], claimed: known?.claimed ?? new Set() }
  const pending = new Set<string>()
  let count = 0
  const stack: [Html.Node, boolean][] = [[documentRoot(node), false]]
  while (stack.length > 0) {
    const [at, closing] = stack.pop()!
    if (closing) {
      index.order.get(at)![1] = count - 1
      continue
    }
    visit(index, pending, at, count++, context)
    stack.push([at, true])
    const children = 'childNodes' in at && !isOpaque(at) ? at.childNodes : []
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i]!, false])
  }
  INDEXES.set(context, index)
  return index
}

/** The first `comment-end` with the same id after the start and its descendants. */
function rangeEnd(index: DocumentIndex, id: string, last: number): Html.Element | undefined {
  const ends = index.ends.get(id) ?? []
  let low = 0
  let high = ends.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (ends[mid]![0] > last) high = mid
    else low = mid + 1
  }
  return ends[low]?.[1]
}

/** C2-M-113: a point comment at the start; its end is dropped, and a range with an inline in it is reported as lost. */
export function rangedComment(node: Html.Element, context: HtmlContext): Inline[] {
  const index = documentIndex(node, context)
  const last = index.order.get(node)![1]
  const end = rangeEnd(index, attr(node, 'data-comment-id') ?? '\0', last)
  const value = plain(node)
  if (value === '') {
    report(context, node, 'import-element-dropped', 'Ranged comment with no text dropped')
    return []
  }
  if (end !== undefined && index.holding[index.order.get(end)![0]]! > index.holding[last + 1]!) {
    report(context, node, 'import-structure-repaired', 'Ranged comment read as a point: its range is lost')
  }
  const mapped = withoutKeys(withoutClasses(attrs(context, node), ['comment-start']), ['data-comment-id'])
  return [{ type: 'critic_comment', value, ...renamedKeys(mapped, RANGED_KEYS) }]
}

/** True for a `comment-end` that a ranged comment read before it has claimed. */
export function isRangeEnd(node: Html.Element, context: HtmlContext): boolean {
  return INDEXES.get(context)?.claimed.has(node) === true
}
