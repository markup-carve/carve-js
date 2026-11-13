// The two engines the tool stands between. The 0.1 engine is the build of `src/` of this
// repository; the 0.2 engine is `v2/`. Nothing here is imported by either.
import { carveToHtml, LIB_VERSION, parse } from '../../dist/index.js'
import { render } from '../../v2/src/index.ts'

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

/** The 0.1 tree of `src` with positions. Offsets are string offsets. */
export function parse01(src: string): Node01 {
  return parse(src, { positions: true }) as unknown as Node01
}

/** The HTML the 0.1 engine gives for `src` under its default options. */
export function html01(src: string): string {
  return carveToHtml(src)
}

/** The HTML the 0.2 engine gives for `src`, with the source line of every block for the report. */
export function html02(src: string, rawHtml: boolean): string {
  return render(src, { sourceLines: true, rawHtml })
}

/** The HTML the 0.2 engine gives for the fragment `src`, for a rule that asks how 0.2 reads a line. */
export function probe02(src: string): string {
  return render(src)
}
