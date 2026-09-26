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

/** Block lists, and a definition list's items: arrays a window may cut. */
function isSliceable(array: unknown[], holder: Slot['owner'], key: string | number): boolean {
  if (array.length === 0) return false
  if (key === 'items' && (holder as { type?: unknown }).type === 'definition_list') return true
  return array.every(
    (value) => value !== null && typeof value === 'object' && SLICEABLE_TYPES.has((value as { type?: unknown }).type as string),
  )
}
