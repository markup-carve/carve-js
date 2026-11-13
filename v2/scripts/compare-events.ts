// Compares another copy of the engine with this one: the block events on every document of up to
// three lines over the enumerator alphabet, and the tree with its inline nodes on every content of
// up to three tokens over the alphabet of inline tokens. Used by scripts/mutate.ts on a surviving mutation.
//   node v2/scripts/compare-events.ts PATH_TO_OTHER_V2
// Prints the first document whose events differ and exits 1, or exits 0 when none does.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { acquireState, type BlockNode, type BlockState, parseTree, scanBlocks } from '../src/index.ts'
import { LINE_SHAPES } from '../test/support/enumerate.ts'
import { INLINE_TOKENS } from '../test/support/inline-enumerate.ts'

interface Engine {
  acquireState(): BlockState
  scanBlocks(state: BlockState, src: string): void
  parseTree(src: string): BlockNode
}

const other = await import(pathToFileURL(join(process.argv[2]!, 'src/index.ts')).href) as Engine
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
    return JSON.stringify(other.parseTree(src)) === JSON.stringify(parseTree(src))
  } catch {
    return false
  }
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
