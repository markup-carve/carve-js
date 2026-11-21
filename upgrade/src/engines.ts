// The two engines the tool stands between. The 0.1 engine is the build of `upgrade/engine-0.1/`
// (`build/engine-0.1/`); the 0.2 engine is `src/`. Nothing here is imported by either.
import { carveToHtml, LIB_VERSION, parse } from '../../build/engine-0.1/index.js'
import { render } from '../../src/index.ts'

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

/** The upgrade is synchronous; repeated passes share the original 0.1 read for one call only. */
export function withUpgradeSession<T>(run: () => T): T {
  const previous = activeSession
  activeSession = { trees: new Map<string, Node01>(), oldHtml: new Map<string, string>(),
    newHtml: [new Map<string, string>(), new Map<string, string>()] }
  try { return run() } finally { activeSession = previous }
}

/** The 0.1 tree of `src` with positions. Offsets are string offsets. */
export function parse01(src: string): Node01 {
  const cached = activeSession?.trees.get(src)
  if (cached !== undefined) return cached
  const tree = parse(src, { positions: true }) as unknown as Node01
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
