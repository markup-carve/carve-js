// Compares another copy of the engine with this one: the block events on every document of up to
// three lines over the enumerator alphabet, the tree with its inline nodes on every content of up
// to three tokens over the alphabet of inline tokens, and the public tree and the HTML under three
// sets of options on the documents of up to two lines, the contents of up to two tokens and the
// examples of the specification. Used by scripts/mutate.ts on a surviving mutation.
//   node v2/scripts/compare-events.ts PATH_TO_OTHER_V2
// Prints the first document whose events differ and exits 1, or exits 0 when none does.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  acquireState, type AstNode, type BlockState, parse, render, type RenderOptions, scanBlocks,
} from '../src/index.ts'
import { parseTree, type TreeNode } from '../test/support/inline-tree.ts'
import { EXAMPLES } from '../test/support/conformance.ts'
import { LINE_SHAPES } from '../test/support/enumerate.ts'
import { INLINE_TOKENS } from '../test/support/inline-enumerate.ts'

interface Engine {
  acquireState(): BlockState
  scanBlocks(state: BlockState, src: string): void
  parse(src: string): AstNode
  render(input: string | AstNode, options?: RenderOptions): string
}

// The defaults, every switch the other way, and the output of a decoded tree.
const OPTION_SETS: readonly RenderOptions[] = [
  {},
  { roundtrip: true, sourceLines: true, sections: false, smartTypography: false, rawHtml: true, headingIds: 'lower' },
  { headingIds: 'off', urlPolicy: { allow: ['https'] }, symbols: { n: '<i>' }, social: { mentionUrl: '/u/{name}', tagUrl: '/t/{name}' } },
]

const other = await import(pathToFileURL(join(process.argv[2]!, 'src/index.ts')).href) as Engine
const otherTree = await import(pathToFileURL(join(process.argv[2]!, 'test/support/inline-tree.ts')).href) as { parseTree(src: string): TreeNode }
const mine = acquireState()
const theirs = other.acquireState()

function sameEvents(src: string): boolean {
  scanBlocks(mine, src)
  try {
    other.scanBlocks(theirs, src)
  } catch {
    return false
  }
  if (mine.eventLength !== theirs.eventLength) return false
  for (let at = 0; at < mine.eventLength; at++) if (mine.events[at] !== theirs.events[at]) return false
  return true
}

function sameTree(src: string): boolean {
  try {
    return JSON.stringify(otherTree.parseTree(src)) === JSON.stringify(parseTree(src))
  } catch {
    return false
  }
}

function attempt(action: () => string): string {
  try {
    return action()
  } catch (error) {
    return `threw ${String(error)}`
  }
}

/** The public tree, its positions included, and the HTML of the source and of the tree under each set of options. */
function sameOutput(src: string): boolean {
  if (attempt(() => JSON.stringify(other.parse(src))) !== attempt(() => JSON.stringify(parse(src)))) return false
  for (const options of OPTION_SETS) {
    if (attempt(() => other.render(src, options)) !== attempt(() => render(src, options))) return false
    if (attempt(() => other.render(other.parse(src), options)) !== attempt(() => render(parse(src), options))) return false
  }
  return true
}

/** Runs `same` on every sequence of `length` parts and exits on the first one that differs. */
function compare(parts: readonly string[], length: number, glue: string, prefix: string, same: (src: string) => boolean): void {
  const choice = new Array<number>(length).fill(0)
  for (;;) {
    const src = prefix + choice.map((index) => parts[index]!).join(glue)
    if (!same(src)) {
      console.log(JSON.stringify(src))
      process.exit(1)
    }
    let at = length - 1
    while (at >= 0 && choice[at] === parts.length - 1) choice[at--] = 0
    if (at < 0) return
    choice[at]!++
  }
}

for (let length = 1; length <= 3; length++) compare(INLINE_TOKENS, length, '', 'x', sameTree)
for (let length = 1; length <= 2; length++) compare(INLINE_TOKENS, length, '', 'x', sameOutput)
for (let lines = 1; lines <= 2; lines++) compare(LINE_SHAPES, lines, '\n', '', sameOutput)
for (const example of EXAMPLES) {
  const variants = [example.input, example.input.replaceAll('a', 'é').replaceAll('\n', '\r\n')]
  for (const src of variants) {
    if (sameOutput(src)) continue
    console.log(JSON.stringify(src))
    process.exit(1)
  }
}

for (let lines = 1; lines <= 3; lines++) {
  const choice = new Array<number>(lines).fill(0)
  for (;;) {
    const src = choice.map((index) => LINE_SHAPES[index]!).join('\n')
    if (!sameEvents(src)) {
      console.log(JSON.stringify(src))
      process.exit(1)
    }
    let at = lines - 1
    while (at >= 0 && choice[at] === LINE_SHAPES.length - 1) choice[at--] = 0
    if (at < 0) break
    choice[at]!++
  }
}
