// The two engines the tool stands between. The 0.1 engine is the build of `upgrade/engine-0.1/`
// (`build/engine-0.1/`); the 0.2 engine is `src/`. Nothing here is imported by either.
import { carveToHtml, LIB_VERSION, parse } from '../../build/engine-0.1/index.js'
import { parse as parse02, render } from '../../src/index.ts'

export interface Pos {
  startLine: number
  endLine: number
  startColumn: number
  endColumn: number
  startOffset: number
  endOffset: number
}

/** A node of the 0.1 tree, read structurally: the tool only looks at the fields it names. */
export interface Node01 {
  type: string
  pos?: Pos
  children?: Node01[]
  items?: Node01[]
  attrs?: Record<string, unknown>
  [field: string]: unknown
}

export const ENGINE_01_VERSION: string = LIB_VERSION

interface UpgradeSession {
  trees: Map<string, Node01>
  oldHtml: Map<string, string>
  newHtml: [Map<string, string>, Map<string, string>]
}

let activeSession: UpgradeSession | null = null

/**
 * The upgrade is synchronous; repeated passes share the original 0.1 read for one call only. A nested
 * call joins the session already open, so one upgrade reads each text once (carve-js#5520).
 */
export function withUpgradeSession<T>(run: () => T): T {
  if (activeSession !== null) return run()
  activeSession = { trees: new Map<string, Node01>(), oldHtml: new Map<string, string>(),
    newHtml: [new Map<string, string>(), new Map<string, string>()] }
  try { return run() } finally { activeSession = null }
}

/** A code point that takes two UTF-16 units, or a lone surrogate. */
const SURROGATE = /[\u{10000}-\u{10FFFF}\uD800-\uDFFF]/u

/** UTF-16 offset of every code point offset of `src`, one entry past the end. */
function codePointTable(src: string): Uint32Array {
  const table = new Uint32Array(src.length + 1)
  let point = 0
  for (let at = 0; at < src.length; point++) {
    table[point] = at
    const unit = src.charCodeAt(at)
    const low = src.charCodeAt(at + 1)
    at += unit >= 0xd800 && unit <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? 2 : 1
  }
  table[point] = src.length
  return table.subarray(0, point + 1)
}

/**
 * Rewrites the code point offsets of every `pos` in a 0.1 tree of `src` into UTF-16 offsets, in place, so that the
 * tool can slice `src` with them. Lines are kept; columns are not read by the tool and stay as 0.1 counts them.
 */
export function utf16Positions<T>(src: string, tree: T): T {
  if (!SURROGATE.test(src)) return tree
  const table = codePointTable(src)
  const at = (offset: number): number => table[Math.min(offset, table.length - 1)]!
  const seen = new WeakSet<object>()
  const convert = (pos: Partial<Pos>): void => {
    if (typeof pos.startOffset === 'number') pos.startOffset = at(pos.startOffset)
    if (typeof pos.endOffset === 'number') pos.endOffset = at(pos.endOffset)
  }
  const stack: unknown[] = [tree]
  while (stack.length > 0) {
    const value = stack.pop()
    if (typeof value !== 'object' || value === null || seen.has(value)) continue
    seen.add(value)
    const pos = Array.isArray(value) ? undefined : (value as { pos?: Partial<Pos> | null }).pos
    if (typeof pos === 'object' && pos !== null && !seen.has(pos)) {
      seen.add(pos)
      convert(pos)
    }
    for (const inner of Object.values(value)) stack.push(inner)
  }
  return tree
}

/** The 0.1 tree of `src` with positions. Offsets are UTF-16 offsets into `src`; lines count from 1. */
export function parse01(src: string): Node01 {
  const cached = activeSession?.trees.get(src)
  if (cached !== undefined) return cached
  const tree = utf16Positions(src, parse(src, { positions: true }) as unknown as Node01)
  activeSession?.trees.set(src, tree)
  return tree
}

/** The HTML the 0.1 engine gives for `src` under its default options. */
export function html01(src: string): string {
  const cached = activeSession?.oldHtml.get(src)
  if (cached !== undefined) return cached
  const html = carveToHtml(src)
  activeSession?.oldHtml.set(src, html)
  return html
}

/** The HTML the 0.2 engine gives for `src`, with the source line of every block for the report. */
export function html02(src: string, rawHtml: boolean): string {
  const cache = activeSession?.newHtml[rawHtml ? 1 : 0]
  const cached = cache?.get(src)
  if (cached !== undefined) return cached
  const html = render(src, { sourceLines: true, rawHtml })
  cache?.set(src, html)
  return html
}

/** The HTML the 0.2 engine gives for the fragment `src`, for a rule that asks how 0.2 reads a line. */
export function probe02(src: string): string {
  return render(src)
}

/** The first and last source line of every top-level block the 0.2 engine reads in `src`. */
export function blocks02(src: string): [number, number][] {
  const tree = parse02(src, { positions: true }) as { children: { pos?: { startLine: number; endLine: number } }[] }
  const out: [number, number][] = []
  for (const child of tree.children) if (child.pos !== undefined) out.push([child.pos.startLine, child.pos.endLine])
  return out
}
