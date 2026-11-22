// C2-W-088: a round escapes every potential opener of each kind its parse reports in a leaf block.
import { childNodes, isBreak, isInlineParent } from './ast.ts'
import type { Node, TextNode } from './ast-nodes.ts'
import { type Check, escapeAt } from './write-check.ts'
import { isAsciiAlphanumeric, isBoundarySpace, isWordCharacter } from './unicode.ts'

/** One leaf of the inline content of a block: a text node, a break, or the markup of another inline node. */
type Leaf = { text: TextNode, lineStart: boolean } | { text: null, kind: 'break' | 'markup' }

interface KindBlock {
  leaves: Leaf[]
}

/** C2-W-088: the text nodes of each block of `group`, in order, with the block that holds them. */
function kindBlocks(group: readonly Node[]): Map<TextNode, KindBlock> {
  const owners = new Map<TextNode, KindBlock>()
  const pending = [...group]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (isInlineParent(node)) {
      const block: KindBlock = { leaves: [] }
      flatten(childNodes(node), block.leaves)
      for (const leaf of block.leaves) if (leaf.text !== null) owners.set(leaf.text, block)
      continue
    }
    for (const child of childNodes(node)) pending.push(child)
  }
  return owners
}

function flatten(nodes: readonly Node[], out: Leaf[]): void {
  for (const node of nodes) {
    if (node.type === 'text') {
      const before = out[out.length - 1]
      out.push({ text: node, lineStart: before === undefined || (before.text === null && before.kind === 'break') })
    } else if (isBreak(node)) out.push({ text: null, kind: 'break' })
    else {
      out.push({ text: null, kind: 'markup' })
      flatten(childNodes(node), out)
      out.push({ text: null, kind: 'markup' })
    }
  }
}

const SLASH = 0x2f
const STAR = 0x2a

/**
 * The kind of the opener escaped at `at`, as a key: `L` and the shape for a line start, else the escaped character,
 * with the mark of a braced opener and `-` twice for the second hyphen of a run (C2-W-090, C2-W-099).
 */
function kindKey(value: string, at: number, line: boolean): string {
  if (line) return `L${lineShape(value)}`
  const ch = value[at]!
  if (ch === '{' && at + 1 < value.length) return `{${value[at + 1]}`
  if (ch === '-' && value[at - 1] === '-') return '--'
  return ch
}

/** The shape of a line opener: its first character, or `0` and the delimiter for an ordered marker. */
function lineShape(value: string): string {
  let end = 0
  while (end < value.length && isAsciiAlphanumeric(value.charCodeAt(end))) end++
  if (end > 0) return `0${value[end] ?? ''}`
  return value[0] ?? ''
}

/** The offsets of the openers of kind `key` in `value`, the text of a leaf of `block`. */
function kindOffsets(key: string, block: KindBlock, index: number): number[] {
  const leaf = block.leaves[index] as { text: TextNode, lineStart: boolean }
  const value = leaf.text.value
  if (key.startsWith('L')) {
    if (!leaf.lineStart || value === '' || `L${lineShape(value)}` !== key) return []
    if (key.startsWith('L0')) {
      let end = 0
      while (end < value.length && isAsciiAlphanumeric(value.charCodeAt(end))) end++
      return [end]
    }
    return [value.startsWith('--') ? 1 : 0]
  }
  const offsets: number[] = []
  if (key === '--') {
    for (let at = 1; at < value.length; at++) if (value[at] === '-' && value[at - 1] === '-' && value[at - 2] !== '-') offsets.push(at)
    return offsets
  }
  const ch = key.charCodeAt(0)
  for (let at = 0; at < value.length; at++) {
    if (value.charCodeAt(at) !== ch) continue
    if (key.length === 2 && value[at + 1] !== key[1]) continue
    if (ch === SLASH || ch === STAR) {
      if (!canOpen(block, index, at)) continue
    } else if (value.charCodeAt(at - 1) === ch) continue
    offsets.push(at)
  }
  return offsets
}

/** C2-I-047, C2-I-049: a delimiter whose neighbors let it open, by the characters written around it. */
function canOpen(block: KindBlock, index: number, at: number): boolean {
  const value = (block.leaves[index] as { text: TextNode }).text.value
  const ch = value.charCodeAt(at)
  const before = at > 0 ? value.codePointAt(at - 1 - (isLow(value, at - 1) ? 1 : 0))! : edge(block, index, -1)
  const after = at + 1 < value.length ? value.codePointAt(at + 1)! : edge(block, index, 1)
  if (before === ch || after === ch) return false
  return !isWordCharacter(before) && after !== -1 && !isBoundarySpace(after)
}

function isLow(value: string, at: number): boolean {
  const code = value.charCodeAt(at)
  return code >= 0xdc00 && code <= 0xdfff && at > 0
}

/** The character next to a leaf, where a text leaf stands there; -1 at a line edge, 0 beside other markup. */
function edge(block: KindBlock, index: number, step: number): number {
  const next = block.leaves[index + step]
  if (next === undefined || next.text === null) return next !== undefined && next.kind === 'markup' ? 0x21 : -1
  const value = next.text.value
  if (value === '') return 0x21
  return step < 0 ? value.codePointAt(value.length - 1 - (isLow(value, value.length - 1) ? 1 : 0))! : value.codePointAt(0)!
}

/**
 * Adds to the escapes of `check` every opener of each kind they report in their block, so the rounds are bounded by
 * the kinds, not by the escapes. A C2-W-125 trial and a block opener inside a line give no kind.
 */
export function escapeKinds(check: Check, group: readonly Node[]): void {
  const trials = new Set(check.trials)
  const reported = check.escapes.filter((escape) => check.ownEscapes.get(escape[0])?.has(escape[1]) !== true && !trials.has(escape))
  if (reported.length === 0) return
  const owners = kindBlocks(group)
  const done = new Map<KindBlock, Set<string>>()
  for (const [node, at] of reported) {
    const block = owners.get(node)
    if (block === undefined) continue
    const key = kindKey(node.value, at, check.lineEscapes.get(node)?.has(at) === true)
    const keys = done.get(block) ?? new Set<string>()
    if (keys.has(key)) continue
    done.set(block, keys.add(key))
    block.leaves.forEach((leaf, index) => {
      if (leaf.text === null) return
      for (const offset of kindOffsets(key, block, index)) escapeAt(check, leaf.text, offset)
    })
  }
}

// The first characters of the block line shapes of data/line-shapes.json; digits and letters start ordered markers.
const LINE_FIRST = '!#$%*+-.:=>[^`{|'

function isLineOpener(leaf: { text: TextNode, lineStart: boolean }, at: number): boolean {
  if (!leaf.lineStart) return false
  const value = leaf.text.value
  if (!isAsciiAlphanumeric(value.charCodeAt(0)) && !LINE_FIRST.includes(value[0] ?? '')) return false
  return kindOffsets(`L${lineShape(value)}`, { leaves: [leaf] }, 0).includes(at)
}

/**
 * Whether the escapes `escapes` of a plan leave an opener of one of their kinds bare in its block (C2-W-010). Without
 * the parse a line-start escape may be of either kind, so both are tested.
 */
export function leavesKindBare(group: readonly Node[], escapes: ReadonlyMap<TextNode, readonly number[]>): boolean {
  for (const block of new Set(kindBlocks(group).values())) {
    const keys = new Set<string>()
    for (const leaf of block.leaves) {
      if (leaf.text === null) continue
      for (const at of escapes.get(leaf.text) ?? []) {
        keys.add(kindKey(leaf.text.value, at, false))
        if (isLineOpener(leaf, at)) keys.add(kindKey(leaf.text.value, at, true))
      }
    }
    for (const key of keys) {
      for (let index = 0; index < block.leaves.length; index++) {
        const leaf = block.leaves[index]!
        if (leaf.text === null) continue
        const placed = escapes.get(leaf.text) ?? []
        for (const offset of kindOffsets(key, block, index)) if (!placed.includes(offset)) return true
      }
    }
  }
  return false
}
