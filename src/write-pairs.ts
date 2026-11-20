// C2-W-146: the text the escaping procedure wrote is tested with the pair rules of lint, and each
// mark of a reported opening run takes a backslash, so canonical output does not fail them.
import { forEachSlot, INLINE_PARENTS, type Node, type TextNode } from './ast.ts'
import { pairedMarks } from './pair-marks.ts'
import { isAsciiPunctuation } from './unicode.ts'

const PAIR_RULES = [
  ['_', 'deprecated-bare-underline'], ['~', 'deprecated-bare-strike'], ['=', 'deprecated-bare-highlight'],
  ['~~', 'markdown-strikethrough-double-tilde'], ['**', 'markdown-strong-double-star'],
] as const

const PARENTS: ReadonlySet<string> = new Set(INLINE_PARENTS)

/** One run of text and soft breaks as the writer spells it, with the text character each source character writes. */
interface Run {
  source: string
  places: ([TextNode, number] | null)[]
}

function escapedAt(escapes: ReadonlyMap<TextNode, readonly number[]>, node: TextNode, at: number): boolean {
  return escapes.get(node)?.includes(at) === true
}

function spell(run: Run, node: TextNode, escapes: ReadonlyMap<TextNode, readonly number[]>): void {
  const value = node.value
  for (let at = 0; at < value.length; at++) {
    const ch = value[at]!
    const escaped = escapedAt(escapes, node, at)
    // C2-W-097: a backslash before punctuation, a space or the end of the line is written as two.
    const next = value.charCodeAt(at + 1)
    if (escaped || (ch === '\\' && (Number.isNaN(next) || next === 32 || next === 10 || isAsciiPunctuation(next)))) {
      run.source += '\\'
      run.places.push(null)
    }
    run.source += ch
    run.places.push([node, at])
  }
}

function testRun(run: Run, found: [TextNode, number][]): void {
  if (run.source === '') return
  for (const [mark, id] of PAIR_RULES) {
    pairedMarks(run.source, mark, id, (start) => {
      for (let at = start; at < start + mark.length; at++) {
        const place = run.places[at]
        if (place !== null && place !== undefined) found.push(place)
      }
    })
  }
}

/** The escapes that the pair rules ask for in `group` under the escapes `escapes` already holds. */
export function pairEscapes(group: readonly Node[], escapes: ReadonlyMap<TextNode, readonly number[]>): [TextNode, number][] {
  const found: [TextNode, number][] = []
  const stack: Node[] = [...group]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (PARENTS.has(node.type) && 'children' in node) {
      let run: Run = { source: '', places: [] }
      for (const child of node.children as readonly Node[]) {
        if (child.type === 'text') spell(run, child, escapes)
        else if (child.type === 'soft_break') {
          run.source += '\n'
          run.places.push(null)
        } else {
          testRun(run, found)
          run = { source: '', places: [] }
        }
      }
      testRun(run, found)
    }
    forEachSlot(node, (nodes) => { for (const child of nodes) stack.push(child) })
  }
  return found.filter(([node, at]) => !escapedAt(escapes, node, at))
}
