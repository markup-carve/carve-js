// The two engines the tool stands between. The 0.1 engine is the build of `upgrade/engine-0.1/`
// (`build/engine-0.1/`); the 0.2 engine is `src/`. Nothing here is imported by either.
import { carveToHtml, LIB_VERSION, parse, renderDocument } from '../../build/engine-0.1/index.js'
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
  input: string
  tree?: Node01
  html?: string
}

let activeSession: UpgradeSession | null = null

/** The upgrade is synchronous; repeated passes share the original 0.1 read for one call only. */
export function withUpgradeSession<T>(input: string, run: () => T): T {
  const previous = activeSession
  activeSession = { input }
  try { return run() } finally { activeSession = previous }
}

/** The 0.1 tree of `src` with positions. Offsets are string offsets. */
export function parse01(src: string): Node01 {
  if (activeSession?.input === src && activeSession.tree !== undefined) return activeSession.tree
  const tree = parse(src, { positions: true }) as unknown as Node01
  if (activeSession?.input === src) activeSession.tree = tree
  return tree
}

/** The HTML the 0.1 engine gives for `src` under its default options. */
export function html01(src: string): string {
  if (activeSession?.input === src && activeSession.html !== undefined) return activeSession.html
  // Rendering resolves and transforms its AST in place. Copy the original parse so
  // later upgrade rules keep their source positions and can still inspect it.
  const html = activeSession?.input === src && activeSession.tree !== undefined
    ? renderDocument(structuredClone(activeSession.tree) as ReturnType<typeof parse>)
    : carveToHtml(src)
  if (activeSession?.input === src) activeSession.html = html
  return html
}

/** The HTML the 0.2 engine gives for `src`, with the source line of every block for the report. */
export function html02(src: string, rawHtml: boolean): string {
  return render(src, { sourceLines: true, rawHtml })
}

/** The HTML the 0.2 engine gives for the fragment `src`, for a rule that asks how 0.2 reads a line. */
export function probe02(src: string): string {
  return render(src)
}
