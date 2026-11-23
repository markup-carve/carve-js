// C2-W-088, C2-W-125 case six: the backtick kind of a block whose glued backtick lengthens a code span.
import { childNodes, isBreak } from './ast.ts'
import type { Node, TextNode } from './ast-nodes.ts'
import { codeSpan } from './write-inline.ts'
import type { Writer } from './write-state.ts'

const CODE_LIKE: ReadonlySet<string> = new Set(['code', 'literal_inline', 'math', 'raw_inline'])
const BACKTICK = 96
const BACKSLASH = 92

interface Bare {
  text: string
  /** Whether each character of `text` is a character of a text node. */
  fromText: boolean[]
  leaves: [TextNode, number][]
  spans: string[]
  glued: boolean
}

function flatten(nodes: readonly Node[], bare: Bare): void {
  let before: Node | undefined
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.value.charCodeAt(0) === BACKTICK && before !== undefined && CODE_LIKE.has(before.type) &&
        before.attrs === undefined) bare.glued = true
      bare.leaves.push([node, bare.text.length])
      bare.text += node.value
      for (let at = 0; at < node.value.length; at++) bare.fromText.push(true)
    } else if (CODE_LIKE.has(node.type) && 'value' in node && typeof node.value === 'string') {
      const spelled = codeSpan(node.value)
      bare.spans.push(`${bare.text.length}:${bare.text.length + spelled.length}`)
      add(bare, spelled)
    } else if (isBreak(node)) add(bare, '\n')
    else {
      add(bare, '\u0001')
      flatten(childNodes(node), bare)
      add(bare, '\u0001')
    }
    before = node
  }
}

function add(bare: Bare, spelled: string): void {
  bare.text += spelled
  for (let at = 0; at < spelled.length; at++) bare.fromText.push(false)
}

/** The code spans that bare text forms by its backtick runs (C2-I-015), as `start:end`. */
function bareSpans(bare: Bare): string[] {
  const runs: [number, number][] = []
  const text = bare.text
  for (let at = 0; at < text.length; at++) {
    if (text.charCodeAt(at) !== BACKTICK) continue
    const start = at
    while (text.charCodeAt(at + 1) === BACKTICK) at++
    const escaped = bare.fromText[start] === true && start > 0 && bare.fromText[start - 1] === true &&
      text.charCodeAt(start - 1) === BACKSLASH
    runs.push([escaped ? start + 1 : start, at + 1])
  }
  // The next run of the same length behind each run, so the pairing reads the runs once.
  const next = new Array<number>(runs.length).fill(-1)
  const nearest = new Map<number, number>()
  for (let at = runs.length - 1; at >= 0; at--) {
    const length = runs[at]![1] - runs[at]![0]
    next[at] = nearest.get(length) ?? -1
    nearest.set(length, at)
  }
  const spans: string[] = []
  for (let open = 0; open < runs.length; open++) {
    const [start, end] = runs[open]!
    const close = next[open]!
    if (start === end || close < 0) continue
    spans.push(`${start}:${runs[close]![1]}`)
    open = close
  }
  return spans
}

/**
 * C2-W-088, C2-W-125 case six: a backtick of text glued behind a code span lengthens its closing run. Where the bare
 * text then pairs the backtick runs of the block otherwise than the tree, its parse holds a code span the tree does
 * not, which reports the backtick kind, so every backtick that starts a run in the text of the block takes a
 * backslash, not only the glued one.
 */
export function escapeBacktickKind(w: Writer, nodes: readonly Node[]): void {
  if (!w.kindRounds) return
  const bare: Bare = { text: '', fromText: [], leaves: [], spans: [], glued: false }
  flatten(nodes, bare)
  if (!bare.glued) return
  const held = new Set(bare.spans)
  if (bareSpans(bare).every((span) => held.has(span))) return
  for (const [node] of bare.leaves) {
    const value = node.value
    const escapes = new Set(w.escapes.get(node) ?? [])
    const before = escapes.size
    for (let at = value.indexOf('`'); at >= 0; at = value.indexOf('`', at + 1)) {
      if (value.charCodeAt(at - 1) !== BACKTICK) escapes.add(at)
    }
    if (escapes.size !== before) w.escapes.set(node, [...escapes].sort((a, b) => a - b))
  }
}
