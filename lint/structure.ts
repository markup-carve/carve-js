import { type Node } from '../src/ast.ts'
import { type LintContext, type Rule } from './types.ts'
import { escaped, isWord } from '../src/pair-marks.ts'

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

interface OpenerLeaf {
  path: string
  start: number
  end: number
  /** The leaf block and the brackets in it, scope 0 being the block. */
  scopes: string[]
  /** The open scopes, innermost last, as the depth-first visit stands. */
  stack: number[]
  openers: [number, string, string, number][]
  /** Where a closer can stand: text and the marks of formed spans, not atoms such as code or a link tail (C2-W-107). */
  content: [number, number, number][]
}

interface OpenerScan { leaf: OpenerLeaf | null, leaves: OpenerLeaf[] }

const openerScans = new WeakMap<LintContext, OpenerScan>()

/** The scope of the node at `path`: its innermost enclosing bracket, else the leaf block. */
function scopeOf(path: string, leaf: OpenerLeaf): number {
  while (leaf.stack.length > 1 && !path.startsWith(`${leaf.scopes[leaf.stack[leaf.stack.length - 1]!]}/`)) leaf.stack.pop()
  return leaf.stack[leaf.stack.length - 1]!
}

function spanMarks(node: Node, range: [number, number], scope: number, leaf: OpenerLeaf, context: LintContext): void {
  if (!('children' in node) || node.children.length === 0) return
  const width = context.source[range[0]] === '{' ? 2 : 1
  leaf.content.push([range[0], range[0] + width, scope])
  const last = bounds(node.children[node.children.length - 1]!, context)
  if (last !== null) leaf.content.push([last[1], last[1] + width, scope])
}

function bracedOpeners(node: Node, path: string, scope: number, leaf: OpenerLeaf, context: LintContext): void {
  if (!('children' in node)) return
  node.children.forEach((child, index) => {
    if (child.type !== 'text') return
    const text = bounds(child, context)
    if (text === null) return
    for (let at = text[0]; at + 1 < text[1]; at++) {
      const mark = context.source[at + 1]!
      if (context.source[at] !== '{' || !BRACED_MARKS.includes(mark) || escaped(context.source, at)) continue
      if (leaf.openers.length === 0) openerScan(context).leaves.push(leaf)
      leaf.openers.push([at, mark, `${path}/children/${index}`, scope])
    }
  })
}

let lastScan: [LintContext, OpenerScan] | null = null

function openerScan(context: LintContext): OpenerScan {
  if (lastScan?.[0] === context) return lastScan[1]
  let scan = openerScans.get(context)
  if (scan === undefined) openerScans.set(context, scan = { leaf: null, leaves: [] })
  lastScan = [context, scan]
  return scan
}

function bracedSpanAsText(node: Node, path: string, context: LintContext): void {
  const scan = openerScan(context)
  const leaf = scan.leaf
  const isLeaf = INLINE_LEAVES.has(node.type)
  const opens = node.type === 'strong' || node.type === 'emphasis'
  // Only a closer after an opener counts, so nothing is kept for a leaf block before its first opener.
  if (!isLeaf && !opens && !BRACKETS.has(node.type) && (leaf?.openers.length ?? 0) === 0) return
  const range = bounds(node, context)
  if (range === null) return
  if (isLeaf) scan.leaf = { path, start: range[0], end: range[1], scopes: [path], stack: [0], openers: [], content: [] }
  else if (leaf !== null && path.startsWith(`${leaf.path}/`)) collectOpeners(node, path, range, leaf, context)
}

function collectOpeners(node: Node, path: string, range: [number, number], leaf: OpenerLeaf, context: LintContext): void {
  const scope = scopeOf(path, leaf)
  if (BRACKETS.has(node.type)) {
    leaf.stack.push(leaf.scopes.length)
    leaf.scopes.push(path)
    return
  }
  // An opener inside a braced span is removed by a braced closer, which the row does not report.
  if ((node.type === 'strong' || node.type === 'emphasis') && context.source[range[0]] !== '{') {
    bracedOpeners(node, path, scope, leaf, context)
  }
  if (leaf.openers.length === 0) return
  if (node.type === 'text' || node.type === 'smart_punctuation') leaf.content.push([range[0], range[1], scope])
  else if (DELIMITED_SPANS.has(node.type)) spanMarks(node, range, scope, leaf, context)
}

/** The last unescaped braced closer of each scope and mark in the content of the leaf block. */
function lastClosers(leaf: OpenerLeaf, context: LintContext): Map<string, number> {
  // Each character holds its scope plus one, or zero outside the content.
  const inside = new Int32Array(leaf.end - leaf.start + 1)
  for (const [start, end, scope] of leaf.content) inside.fill(scope + 1, start - leaf.start, end - leaf.start)
  const last = new Map<string, number>()
  const source = context.source
  for (let at = leaf.start + 1; at < leaf.end; at++) {
    if (source.charCodeAt(at) !== 0x7d) continue
    const mark = source[at - 1]!
    const scope = inside[at - leaf.start]!
    if (scope !== 0 && inside[at - 1 - leaf.start] === scope && BRACED_MARKS.includes(mark)
      && !escapedInside(at - 1, leaf, inside, source)) last.set(`${scope - 1}${mark}`, at - 1)
  }
  return last
}

/** Whether a backslash run of the content, right before `at`, escapes it. */
function escapedInside(at: number, leaf: OpenerLeaf, inside: Int32Array, source: string): boolean {
  let slashes = 0
  while (at - 1 - slashes >= leaf.start && inside[at - 1 - slashes - leaf.start] !== 0 && source[at - 1 - slashes] === '\\') {
    slashes++
  }
  return slashes % 2 === 1
}

/** C2-I-059: an opener counts when a braced closer of its mark follows it in the same content. */
function finishBracedOpeners(context: LintContext): void {
  lastScan = null
  for (const leaf of openerScans.get(context)?.leaves ?? []) {
    const last = lastClosers(leaf, context)
    for (const [at, mark, path, scope] of leaf.openers) {
      if ((last.get(`${scope}${mark}`) ?? -1) >= at + 2) context.report('braced-span-opener-as-text', at, at + 2, path)
    }
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
