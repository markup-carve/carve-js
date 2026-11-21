import type { BlockNode, Document } from '../../ast.js'

/**
 * A pruned view of a document for the escape-narrowing search in
 * `render-carve.ts`: only the sibling blocks around a group of escape units,
 * inside their real ancestor containers. Rendering and re-parsing that view
 * costs the window, where the whole document costs every probe O(n).
 *
 * A probe answered here is a prediction; the caller re-verifies the finished
 * state against the whole document and redoes the search globally when it
 * does not hold.
 */

const SLICEABLE_TYPES: ReadonlySet<string> = new Set([
  'heading', 'section', 'paragraph', 'block_quote', 'list', 'list_item', 'code_block',
  'thematic_break', 'table', 'admonition', 'directive', 'div', 'line_block',
  'definition_list', 'figure', 'figure_group', 'image', 'abbreviation_def',
  'link_reference_definition', 'citation_definition', 'raw_block', 'comment',
])

interface Slot {
  owner: Record<string | number, unknown>
  key: string | number
  array: unknown[]
}

interface Step {
  slot: Slot
  index: number
}

interface NodeInfo {
  parent: object | null
  step: Step | undefined
}

/** Every slot on a path to the units, each cut to the range the paths use. */
export type EscapeWindow = Array<{ slot: Slot; lo: number; hi: number }>

export class EscapeWindows {
  private readonly info = new Map<object, NodeInfo>()

  constructor(private readonly ast: Document) {
    // Same reach as `collectEscapeUnits`: iterative, into nested arrays, `attrs`
    // and `pos` skipped. Untyped objects (a definition list's items) are
    // recorded too, so a path can pass through them.
    type Frame = { value: unknown; parent: object | null; step?: Step | undefined; holder?: Slot['owner']; key?: string | number }
    const stack: Frame[] = [{ value: ast, parent: null }]
    while (stack.length > 0) {
      const { value, parent, step, holder, key } = stack.pop()!
      if (!value || typeof value !== 'object') continue
      if (Array.isArray(value)) {
        const slot: Slot | undefined =
          holder !== undefined && key !== undefined && isSliceable(value, holder, key) ? { owner: holder, key, array: value } : undefined
        for (let i = value.length - 1; i >= 0; i--) {
          stack.push({ value: value[i], parent, step: slot && { slot, index: i }, holder: value as unknown as Slot['owner'], key: i })
        }
        continue
      }
      if (this.info.has(value)) continue
      this.info.set(value, { parent, step })
      const record = value as Record<string, unknown>
      for (const name of Object.keys(record)) {
        if (name === 'attrs' || name === 'pos') continue
        stack.push({ value: record[name], parent: record, holder: record, key: name })
      }
    }
  }

  /**
   * The windows around `units`: one per cluster of units whose padded ranges
   * touch, split again inside a block every unit of a cluster passes through,
   * and kept apart per footnote body. Null when a unit sits outside both.
   * Blocks between two clusters render the same before and after a probe, so
   * a far apart group costs its clusters rather than everything between them.
   */
  windowsFor(units: Iterable<object>): EscapeWindow[] | null {
    const roots = new Map<unknown[], Step[][]>()
    for (const unit of units) {
      const path = this.pathOf(unit)
      if (path === null || path.length === 0 || !this.isRoot(path[0]!.slot)) return null
      const root = path[0]!.slot.array
      let paths = roots.get(root)
      if (paths === undefined) roots.set(root, paths = [])
      paths.push(path)
    }
    if (roots.size === 0) return null
    const windows: EscapeWindow[] = []
    for (const paths of roots.values()) {
      for (const cluster of clusters(paths, 0)) windows.push(windowOf(cluster))
    }
    return windows
  }

  /**
   * Render `window` as a document. The slots are swapped in place, so unit
   * identity survives, and restored before returning.
   */
  renderPruned(window: EscapeWindow, render: (doc: Document) => string): string | null {
    const top = window[0]!
    if (!this.isRoot(top.slot)) return null
    const restore: Array<() => void> = []
    try {
      for (let i = 1; i < window.length; i++) {
        const { slot, lo, hi } = window[i]!
        slot.owner[slot.key] = slot.array.slice(lo, hi + 1)
        restore.push(() => {
          slot.owner[slot.key] = slot.array
        })
      }
      if (top.slot.owner === (this.ast as unknown as Record<string, unknown>)) {
        return render({ type: 'document', children: top.slot.array.slice(top.lo, top.hi + 1) as BlockNode[] })
      }
      // A footnote body keeps its first block, which is written on the label line.
      const body = top.slot.array.slice(0, top.hi + 1) as BlockNode[]
      return render({ type: 'document', children: [], footnoteDefs: { [top.slot.key]: body } })
    } catch {
      return null
    } finally {
      for (const undo of restore) undo()
    }
  }

  /** The document body, or one footnote's body. */
  private isRoot(slot: Slot): boolean {
    return (slot.owner === (this.ast as unknown as Record<string, unknown>) && slot.key === 'children') ||
      (slot.owner === (this.ast.footnoteDefs as Record<string, unknown> | undefined) && typeof slot.key === 'string')
  }

  private pathOf(unit: object): Step[] | null {
    const path: Step[] = []
    let current: object | null = unit
    while (current !== null) {
      const node = this.info.get(current)
      if (node === undefined) return null
      if (node.step !== undefined) path.push(node.step)
      current = node.parent
    }
    return path.reverse()
  }
}

/**
 * `paths`, which share their slot at `depth`, grouped by padded ranges that
 * touch there. A group inside one block whose paths all continue into the same
 * slot is split again one level down.
 */
function clusters(paths: Step[][], depth: number): Step[][][] {
  const sorted = paths.slice().sort((a, b) => a[depth]!.index - b[depth]!.index)
  const groups: Step[][][] = []
  let group: Step[][] = []
  let reach = -Infinity
  for (const path of sorted) {
    const pad = depth === path.length - 1 ? 1 : 0
    const index = path[depth]!.index
    if (group.length > 0 && index - pad > reach + 1) {
      groups.push(group)
      group = []
    }
    group.push(path)
    reach = Math.max(reach, index + pad)
  }
  groups.push(group)
  return groups.flatMap((members) => {
    const first = members[0]!
    const inner = first[depth + 1]?.slot.array
    const nested = inner !== undefined && members.every((path) =>
      path[depth]!.index === first[depth]!.index && path[depth + 1]?.slot.array === inner)
    return nested ? clusters(members, depth + 1) : [members]
  })
}

/** Every slot on `paths`, each cut to the range the paths use. */
function windowOf(paths: Step[][]): EscapeWindow {
  const ranges = new Map<unknown[], { slot: Slot; lo: number; hi: number }>()
  for (const path of paths) {
    for (let depth = 0; depth < path.length; depth++) {
      const { slot, index } = path[depth]!
      // Only the innermost slot keeps a neighbor on each side; an ancestor keeps just the spine.
      const pad = depth === path.length - 1 ? 1 : 0
      const lo = Math.max(0, index - pad)
      const hi = Math.min(slot.array.length - 1, index + pad)
      const range = ranges.get(slot.array)
      if (range === undefined) {
        ranges.set(slot.array, { slot, lo, hi })
      } else {
        if (lo < range.lo) range.lo = lo
        if (hi > range.hi) range.hi = hi
      }
    }
  }
  return [...ranges.values()]
}

/** Block lists, and a definition list's items: arrays a window may cut. */
function isSliceable(array: unknown[], holder: Slot['owner'], key: string | number): boolean {
  if (array.length === 0) return false
  if (key === 'items' && (holder as { type?: unknown }).type === 'definition_list') return true
  return array.every(
    (value) => value !== null && typeof value === 'object' && SLICEABLE_TYPES.has((value as { type?: unknown }).type as string),
  )
}
