import type { BlockNode, Document } from './ast.js'

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
  owner: Record<string, unknown>
  key: string
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
    // Same traversal as `collectEscapeUnits`: iterative, `attrs` and `pos` skipped.
    const stack: Array<{ value: unknown; parent: object | null; step: Step | undefined }> = [
      { value: ast, parent: null, step: undefined },
    ]
    while (stack.length > 0) {
      const { value, parent, step } = stack.pop()!
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const record = value as Record<string, unknown>
      let owner = parent
      if (typeof record['type'] === 'string') {
        if (this.info.has(record)) continue
        this.info.set(record, { parent, step })
        owner = record
      }
      for (const key of Object.keys(record)) {
        if (key === 'attrs' || key === 'pos') continue
        const child = record[key]
        if (!Array.isArray(child)) {
          stack.push({ value: child, parent: owner, step: undefined })
          continue
        }
        const sliceable = record['type'] !== undefined && child.length > 0 && child.every(isSliceable)
        const slot: Slot = { owner: record, key, array: child }
        for (let i = child.length - 1; i >= 0; i--) {
          stack.push({ value: child[i], parent: owner, step: sliceable ? { slot, index: i } : undefined })
        }
      }
    }
  }

  /** The window around `units`, or null when a unit sits outside the document body. */
  windowFor(units: Iterable<object>): EscapeWindow | null {
    const ranges = new Map<unknown[], { slot: Slot; lo: number; hi: number }>()
    let root: unknown[] | undefined
    for (const unit of units) {
      const path = this.pathOf(unit)
      if (path === null || path.length === 0) return null
      if (root === undefined) root = path[0]!.slot.array
      if (path[0]!.slot.array !== root) return null
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
    if (root === undefined) return null
    return [...ranges.values()]
  }

  /**
   * Render `window` as a document. The slots are swapped in place, so unit
   * identity survives, and restored before returning.
   */
  renderPruned(window: EscapeWindow, render: (doc: Document) => string): string | null {
    const top = window[0]!
    if (top.slot.owner !== (this.ast as unknown as Record<string, unknown>) || top.slot.key !== 'children') return null
    const restore: Array<() => void> = []
    try {
      for (let i = 1; i < window.length; i++) {
        const { slot, lo, hi } = window[i]!
        slot.owner[slot.key] = slot.array.slice(lo, hi + 1)
        restore.push(() => {
          slot.owner[slot.key] = slot.array
        })
      }
      return render({ type: 'document', children: top.slot.array.slice(top.lo, top.hi + 1) as BlockNode[] })
    } catch {
      return null
    } finally {
      for (const undo of restore) undo()
    }
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

function isSliceable(value: unknown): boolean {
  return value !== null && typeof value === 'object' && SLICEABLE_TYPES.has((value as { type?: unknown }).type as string)
}
