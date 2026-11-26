import { type Node } from '../src/ast.ts'
import { type LintContext, type Rule } from './types.ts'
import { escaped, isWord } from '../src/pair-marks.ts'
import { type AttributeMemo, emptyMemo, readAttributeBlock } from '../src/attributes.ts'

function bounds(node: Node, context: LintContext): [number, number] | null {
  if (node.pos === undefined) return null
  return [context.chars[node.pos.startOffset] ?? 0, context.chars[node.pos.endOffset] ?? context.source.length]
}

function reportNode(id: Rule['id'], node: Node, path: string, context: LintContext,
  values?: Record<string, string>, message?: number): void {
  const range = bounds(node, context)
  if (range !== null) context.report(id, range[0], range[1], path, values, message)
}

function raw(node: Node, context: LintContext): string {
  const range = bounds(node, context)
  return range === null ? '' : context.source.slice(range[0], range[1])
}

function substitutionArrow(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'strike') return
  for (const child of node.children) {
    if (child.type !== 'text') continue
    const range = bounds(child, context)
    if (range === null) continue
    const source = raw(child, context)
    for (let at = source.indexOf('~>'); at >= 0; at = source.indexOf('~>', at + 2)) {
      if (!escaped(source, at)) return reportNode('deprecated-substitution-arrow', node, path, context)
    }
  }
}

function isBidiControl(code: number): boolean {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
}

function bidiControl(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text' && node.type !== 'code' && node.type !== 'code_block' && node.type !== 'math') return
  if (node.type === 'text' && path.includes('/title/')
    && context.nodeTypes.get(path.slice(0, path.indexOf('/title/'))) === 'code_block') return
  const range = bounds(node, context)
  if (range === null) return
  const text = context.source.slice(range[0], range[1])
  const from = node.type === 'code_block' && context.layouts.size > 0 ? text.indexOf('\n') + 1 : 0
  for (let at = from; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (isBidiControl(code)) {
      context.report('bidi-control-in-source', range[0] + at, range[0] + at + 1, path,
        { code: code.toString(16).toUpperCase().padStart(4, '0') })
    }
  }
}

function platformIssue(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length; at++) {
    if (source[at] !== '#' || isWord(source[at - 1]) || !isDigit(source[at + 1])) continue
    let end = at + 1
    while (isDigit(source[end])) end++
    context.report('platform-issue-reference', range[0] + at, range[0] + end, path,
      { host: 'GitHub', text: source.slice(at, end) })
    at = end - 1
  }
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

function platformMention(node: Node, path: string, context: LintContext): void {
  if (node.type === 'mention') {
    reportNode('platform-mention-token', node, path, context,
      { host: 'GitHub', text: raw(node, context) })
    return
  }
  if (node.type !== 'text') return
  const source = raw(node, context)
  const range = bounds(node, context)
  if (range === null) return
  for (let at = 0; at < source.length; at++) {
    if (source[at] !== '@' || isWord(source[at - 1]) || !isWord(source[at + 1])) continue
    let end = at + 1
    while (isWord(source[end]) || source[end] === '-') end++
    context.report('platform-mention-token', range[0] + at, range[0] + end, path,
      { host: 'GitHub', text: source.slice(at, end) })
    at = end - 1
  }
}

function commentInLabel(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'comment' || node.form !== 'line' || node.pos === undefined) return
  const line = context.lines[node.pos.startLine - 1]
  const range = bounds(node, context)
  if (line === undefined || range === null) return
  const before = context.source.slice(line.start, range[0])
  const open = before.lastIndexOf('[')
  if (open < 0 || before.indexOf(']', open) >= 0) return
  // C2-I-077: only a comment that takes the label's closer leaves the label unclosed; `[ %%` had none to take.
  if (!context.source.slice(range[0], line.end).includes(']')) return
  context.report('comment-in-reference-label', range[0], range[1], path)
}

/** C2-W-106 table: a block of an item, after its first, that starts past the marker and short of the content column. */

/** Each block of a list item, other than a paragraph, that starts past the item's content column. */

/** The whole opening mark of a block opener, as the row of `block-opener-overindented` states its range (carve#6192). */

/** Where the opening mark of a block stands: an attributed block starts at its attribute lines (C2-W-138). */

// C2-I-043: the marks of a braced opener.
const BRACED_MARKS = '*/_~=+-^,'
const INLINE_LEAVES: ReadonlySet<string> = new Set(['paragraph', 'heading', 'definition_term', 'cell_paragraph', 'line',
  'citation_definition'])
const DELIMITED_SPANS: ReadonlySet<string> = new Set(['emphasis', 'strong', 'underline', 'strike', 'highlight',
  'superscript', 'subscript', 'insert', 'delete'])
// C2-I-007: a delimiter pairs only inside its bracket.
const BRACKETS: ReadonlySet<string> = new Set(['link', 'span', 'inline_footnote', 'inline_extension'])

/** The braced openers of one leaf block, from its first text opener on. Scope 0 is the block, each bracket a scope. */
interface OpenerLeaf {
  start: number
  end: number
  /** Text openers: offset, scope and the path of the text node, in source order. */
  openers: number[]
  openerScopes: number[]
  openerPaths: string[]
  /** Braced openers of formed spans, which take closers too (C2-I-058). */
  formed: number[]
  formedScopes: number[]
  /** Where a closer can stand, as start, end and scope: text and the marks of spans, no atom (C2-W-107). */
  content: number[]
}

interface OpenerScan {
  path: string | null
  start: number
  end: number
  /** The bracket path prefixes of the current leaf block, and the open ones as indexes, innermost last. */
  scopes: string[]
  stack: number[]
  /** The paths of the bare strong and emphasis spans of the current leaf block. */
  bare: Set<string>
  memo: AttributeMemo
  /** The record of the current leaf block, which keeps formed spans before its first text opener too. */
  pending: OpenerLeaf
  /** The pending record once it holds a text opener. */
  leaf: OpenerLeaf | null
  leaves: OpenerLeaf[]
}

function openerLeaf(): OpenerLeaf {
  return { start: 0, end: 0, openers: [], openerScopes: [], openerPaths: [], formed: [], formedScopes: [], content: [] }
}

const openerScans = new WeakMap<LintContext, OpenerScan>()
let lastScan: [LintContext, OpenerScan] | null = null

function openerScan(context: LintContext): OpenerScan {
  if (lastScan?.[0] === context) return lastScan[1]
  let scan = openerScans.get(context)
  if (scan === undefined) {
    openerScans.set(context, scan = { path: null, start: 0, end: 0, scopes: [], stack: [0], bare: new Set(), memo: emptyMemo(),
      pending: openerLeaf(), leaf: null, leaves: [] })
  }
  lastScan = [context, scan]
  return scan
}

/** The scope of the node at `path`: its innermost enclosing bracket, else the leaf block. */
function scopeOf(path: string, scan: OpenerScan): number {
  while (scan.stack.length > 1 && !path.startsWith(scan.scopes[scan.stack[scan.stack.length - 1]!]!)) scan.stack.pop()
  return scan.stack[scan.stack.length - 1]!
}

function startLeaf(node: Node, path: string, scan: OpenerScan, context: LintContext): void {
  const range = bounds(node, context)
  scan.path = range === null ? null : `${path}/`
  if (range !== null) [scan.start, scan.end] = range
  scan.scopes.length = 1
  scan.stack.length = 1
  scan.bare.clear()
  if (scan.leaf !== null) scan.pending = openerLeaf()
  else scan.pending.formed.length = scan.pending.formedScopes.length = scan.pending.content.length = 0
  scan.pending.start = scan.start
  scan.pending.end = scan.end
  scan.leaf = null
}

function bracedSpanAsText(node: Node, path: string, context: LintContext): void {
  const scan = openerScan(context)
  if (INLINE_LEAVES.has(node.type)) return startLeaf(node, path, scan, context)
  const opens = node.type === 'strong' || node.type === 'emphasis'
  // Only a closer after an opener counts, so no text is kept for a leaf block before its first opener.
  if (scan.path === null || (scan.leaf === null && !opens && !BRACKETS.has(node.type) && !DELIMITED_SPANS.has(node.type)
    && (node.type !== 'text' || scan.bare.size === 0))) return
  if (!path.startsWith(scan.path)) return
  const range = bounds(node, context)
  if (range !== null) collectOpeners(node, path, range, scan, context)
}

function collectOpeners(node: Node, path: string, range: [number, number], scan: OpenerScan, context: LintContext): void {
  const scope = scopeOf(path, scan)
  if (BRACKETS.has(node.type)) {
    scan.stack.push(scan.scopes.length)
    scan.scopes.push(`${path}/`)
    return
  }
  // An opener inside a braced span is removed by a braced closer, which the row does not report.
  if ((node.type === 'strong' || node.type === 'emphasis') && context.source[range[0]] !== '{') scan.bare.add(path)
  if (node.type === 'text' && scan.bare.has(path.slice(0, path.lastIndexOf('/children/')))) {
    bracedOpeners(path, range, scope, scan, context)
  }
  // A formed span before the first opener can still remove it when it closes (C2-I-059).
  if (DELIMITED_SPANS.has(node.type)) return spanMarks(node, range, scope, scan.pending, context)
  const leaf = scan.leaf
  if (leaf === null) return
  if (node.type === 'text') textContent(range, scope, scan, leaf, context.source)
  else if (node.type === 'smart_punctuation') leaf.content.push(range[0], range[1], scope)
}

/** C2-I-043: a valid attribute block left as text is still an atom, so no closer stands in it. */
function textContent([start, end]: [number, number], scope: number, scan: OpenerScan, leaf: OpenerLeaf, source: string): void {
  let from = start
  for (let at = start; at < end; at++) {
    if (source.charCodeAt(at) !== 0x7b || escaped(source, at)) continue
    const after = readAttributeBlock(source, at, end, scan.memo, null)
    if (after < 0) continue
    if (at > from) leaf.content.push(from, at, scope)
    from = after
    at = after - 1
  }
  if (end > from) leaf.content.push(from, end, scope)
}

/** The braced openers left as text in a text child of a bare strong or emphasis, collected in source order. */
function bracedOpeners(path: string, text: [number, number], scope: number, scan: OpenerScan, context: LintContext): void {
  const source = context.source
  for (let at = text[0]; at + 1 < text[1]; at++) {
    if (source.charCodeAt(at) !== 0x7b || escaped(source, at)) continue
    // C2-I-043: a valid attribute block at a brace comes before a braced opener.
    const block = readAttributeBlock(source, at, text[1], scan.memo, null)
    if (block >= 0) {
      at = block - 1
      continue
    }
    if (!BRACED_MARKS.includes(source[at + 1]!)) continue
    if (scan.leaf === null) {
      scan.leaf = scan.pending
      scan.leaves.push(scan.leaf)
    }
    scan.leaf.openers.push(at)
    scan.leaf.openerScopes.push(scope)
    scan.leaf.openerPaths.push(path)
  }
}

function spanMarks(node: Node, range: [number, number], scope: number, leaf: OpenerLeaf, context: LintContext): void {
  if (!('children' in node) || node.children.length === 0) return
  const width = context.source[range[0]] === '{' ? 2 : 1
  if (width === 2) {
    leaf.formed.push(range[0])
    leaf.formedScopes.push(scope)
  }
  leaf.content.push(range[0], range[0] + width, scope)
  const last = bounds(node.children[node.children.length - 1]!, context)
  if (last !== null) leaf.content.push(last[1], last[1] + width, scope)
}

/** The open braced openers of one scope, with the count of each mark. */
interface OpenStack { at: number[], marks: string[], text: boolean[], counts: Map<string, number> }

/** C2-I-058, C2-I-059: a closer takes the nearest open opener of its mark and removes every opener above it. */
function closeNearest(stack: OpenStack, mark: string): number {
  if ((stack.counts.get(mark) ?? 0) === 0) return -1
  for (;;) {
    const at = stack.at.pop()!
    const top = stack.marks.pop()!
    const text = stack.text.pop()!
    stack.counts.set(top, stack.counts.get(top)! - 1)
    if (top === mark) return text ? at : -1
  }
}

function pushOpener(stacks: OpenStack[], at: number, mark: string, scope: number, text: boolean): void {
  const stack = stacks[scope] ??= { at: [], marks: [], text: [], counts: new Map() }
  stack.at.push(at)
  stack.marks.push(mark)
  stack.text.push(text)
  stack.counts.set(mark, (stack.counts.get(mark) ?? 0) + 1)
}

let insideBuffer = new Int32Array(0)

/** Each character of the leaf block holds its scope plus one, or zero outside the content. */
function contentScopes(leaf: OpenerLeaf): Int32Array {
  const length = leaf.end - leaf.start + 1
  if (insideBuffer.length < length) insideBuffer = new Int32Array(length * 2)
  insideBuffer.fill(0, 0, length)
  for (let at = 0; at < leaf.content.length; at += 3) {
    insideBuffer.fill(leaf.content[at + 2]! + 1, leaf.content[at]! - leaf.start, leaf.content[at + 1]! - leaf.start)
  }
  return insideBuffer
}

interface OpenCursor { stacks: OpenStack[], text: number, formed: number }

/** Opens, in source order, every text and formed opener that starts before `end`. */
function openBefore(end: number, cursor: OpenCursor, leaf: OpenerLeaf, source: string): void {
  for (;;) {
    const text = leaf.openers[cursor.text] ?? Infinity
    const formed = leaf.formed[cursor.formed] ?? Infinity
    if (Math.min(text, formed) >= end) return
    if (text < formed) pushOpener(cursor.stacks, text, source[text + 1]!, leaf.openerScopes[cursor.text++]!, true)
    else pushOpener(cursor.stacks, formed, source[formed + 1]!, leaf.formedScopes[cursor.formed++]!, false)
  }
}

/** The text openers that a braced closer of their content would pair with. */
function pairedOpeners(leaf: OpenerLeaf, context: LintContext): Set<number> {
  const inside = contentScopes(leaf)
  const cursor: OpenCursor = { stacks: [], text: 0, formed: 0 }
  const paired = new Set<number>()
  const source = context.source
  for (let at = leaf.start + 1; at < leaf.end; at++) {
    if (source.charCodeAt(at) !== 0x7d) continue
    openBefore(at - 1, cursor, leaf, source)
    const mark = source[at - 1]!
    const scope = inside[at - leaf.start]!
    if (scope === 0 || inside[at - 1 - leaf.start] !== scope || !BRACED_MARKS.includes(mark)
      || escapedInside(at - 1, leaf, inside, source)) continue
    const stack = cursor.stacks[scope - 1]
    const taken = stack === undefined ? -1 : closeNearest(stack, mark)
    if (taken >= 0) paired.add(taken)
  }
  return paired
}

/** Whether a backslash run of the content, right before `at`, escapes it. */
function escapedInside(at: number, leaf: OpenerLeaf, inside: Int32Array, source: string): boolean {
  let slashes = 0
  while (at - 1 - slashes >= leaf.start && inside[at - 1 - slashes - leaf.start] !== 0 && source[at - 1 - slashes] === '\\') {
    slashes++
  }
  return slashes % 2 === 1
}

/** C2-I-059: an opener counts when a braced closer of its mark in the same content would pair with it. */
function finishBracedOpeners(context: LintContext): void {
  lastScan = null
  for (const leaf of openerScans.get(context)?.leaves ?? []) {
    const paired = pairedOpeners(leaf, context)
    leaf.openers.forEach((at, index) => {
      if (paired.has(at)) context.report('braced-span-opener-as-text', at, at + 2, leaf.openerPaths[index]!)
    })
  }
}

function nonDescriptiveLink(node: Node, path: string, context: LintContext): void {
  if (node.type !== 'link' || node.children.length !== 1) return
  const child = node.children[0]
  if (child?.type !== 'text') return
  const value = child.value.toLowerCase().trim().replace(/\s+/g, ' ')
  if (value === 'here' || value === 'click here' || value === 'read more') {
    reportNode('non-descriptive-link-text', node, path, context)
  }
}

export function finishStructure(context: LintContext): void {
  finishBracedOpeners(context)
  for (let at = context.diagnostics.length - 1; at >= 0; at--) {
    const entry = context.diagnostics[at]!
    if (entry.code !== 'platform-issue-reference' && entry.code !== 'platform-mention-token') continue
    const footnote = [...context.state.footnoteKeys].find(([path]) => entry.path?.startsWith(`${path}/`))
    if (footnote === undefined || context.state.usedFootnotes.has(footnote[1])) continue
    context.diagnostics.splice(at, 1)
    context.findingLines.splice(at, 1)
  }
}

/** C2-N-072: the attribute line above an include without `code` applies to nothing. */

/** C2-N-088: `lines` on a delimited table include counts physical lines, where `rows` counts records. */

function nodeRule(id: Rule['id'], nodes: readonly Node['type'][] , checkNode: NonNullable<Rule['checkNode']>): Rule {
  return { id, nodes, checkNode }
}

export const NODE_RULES: readonly Rule[] = [
                  nodeRule('deprecated-substitution-arrow', ['strike'], substitutionArrow),
  nodeRule('bidi-control-in-source', ['text', 'code', 'code_block', 'math'], bidiControl),
  nodeRule('platform-issue-reference', ['text'], platformIssue),
  nodeRule('platform-mention-token', ['text', 'mention'], platformMention),
      nodeRule('comment-in-reference-label', ['comment'], commentInLabel),
    nodeRule('braced-span-opener-as-text', ['text', 'smart_punctuation', ...DELIMITED_SPANS, ...BRACKETS, ...INLINE_LEAVES] as
      Node['type'][],
      bracedSpanAsText),
  nodeRule('non-descriptive-link-text', ['link'], nonDescriptiveLink),
      ]
