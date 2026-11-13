// Compares the block events of another copy of the engine with this one, on every document of up
// to three lines over the enumerator alphabet. Used by scripts/mutate.ts on a surviving mutation.
//   node v2/scripts/compare-events.ts PATH_TO_OTHER_V2
// Prints the first document whose events differ and exits 1, or exits 0 when none does.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { acquireState, type BlockState, scanBlocks } from '../src/index.ts'
import { LINE_SHAPES } from '../test/support/enumerate.ts'

interface Engine {
  acquireState(): BlockState
  scanBlocks(state: BlockState, src: string): void
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
