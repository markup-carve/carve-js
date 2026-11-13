// Differential against djot.js on the constructs whose block rules 0.2 shares with Djot:
// paragraphs with lazy lines, block quotes, bullet lists, fenced code and the star thematic break.
//   node v2/scripts/differential.ts [N]      (default 4)
// Every document of up to N lines over a small alphabet is parsed by both. A difference is
// irreducible when no shorter run of its lines differs on its own; each irreducible difference
// is filed under the 0.2 clause that explains it, and one that fits no clause is printed.
import { carveStructure, djotStructure } from '../test/support/djot.ts'

const LINE_SHAPES = [
  '', 'a', '  a', '- a', '  - a', '    - a', '* a', '> a', '>', '  > a', '- > a', '```', '  ```', '***',
]

const EXPLANATIONS = [
  'C2-B-062: a blank line inside an item does not make its list loose',
  'C2-B-052: three blank lines end a list',
  'C2-B-014: a fence line interrupts a paragraph',
  'C2-B-015, C2-B-056: a marker past the item\'s marker opens a nested list without a blank line',
  'C2-B-025: an item that joined its list from the left owns lines from its own marker column',
  'C2-B-012: a line that is no interrupter stays a lazy line, also without the container\'s prefix',
]

function count(text: string, part: string): number {
  return text.split(part).length - 1
}

/** Index into EXPLANATIONS, or -1. */
function explain(lines: string[], carve: string, djot: string): number {
  if (carve.replaceAll(',loose', '') === djot.replaceAll(',loose', '')) return 0
  let blanks = 0
  let longest = 0
  for (const line of lines) {
    blanks = line === '' ? blanks + 1 : 0
    if (blanks > longest) longest = blanks
  }
  if (longest >= 3 && count(carve, 'ul(') > count(djot, 'ul(')) return 1
  if (count(carve, 'code') > count(djot, 'code')) return 2
  if (longest === 0 && count(carve, 'ul(') > count(djot, 'ul(')) return 3
  if (longest > 0 && joinsFromLeft(lines)) return 4
  if (longest === 0 && count(carve, '[') < count(djot, '[') + count(djot, 'hr')) return 5
  return -1
}

/** True when a marker at column 0 follows a blank line below an indented marker (C2-B-054). */
function joinsFromLeft(lines: string[]): boolean {
  let indented = false
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!
    if (line.startsWith('  ') && line.trimStart().startsWith('-')) indented = true
    else if (indented && at > 0 && lines[at - 1] === '' && line.startsWith('-')) return true
  }
  return false
}

function differs(lines: string[]): boolean {
  const src = lines.join('\n')
  return carveStructure(src) !== djotStructure(src)
}

const maxLines = Number(process.argv[2] ?? 4)
let unexplained = 0
for (let n = 1; n <= maxLines; n++) {
  const perClause = new Array<number>(EXPLANATIONS.length).fill(0)
  let documents = 0
  let different = 0
  const choice = new Array<number>(n).fill(0)
  for (;;) {
    const lines = choice.map((index) => LINE_SHAPES[index]!)
    documents++
    if (differs(lines)) {
      different++
      let reducible = false
      for (let length = 1; length < n && !reducible; length++) {
        for (let start = 0; start + length <= n && !reducible; start++) reducible = differs(lines.slice(start, start + length))
      }
      if (!reducible) {
        const src = lines.join('\n')
        const clause = explain(lines, carveStructure(src), djotStructure(src))
        if (clause >= 0) {
          perClause[clause]!++
        } else {
          unexplained++
          console.log(`unexplained: ${JSON.stringify(src)}\n  0.2:  ${carveStructure(src)}\n  djot: ${djotStructure(src)}`)
        }
      }
    }
    let at = n - 1
    while (at >= 0 && choice[at] === LINE_SHAPES.length - 1) choice[at--] = 0
    if (at < 0) break
    choice[at]!++
  }
  console.log(`N = ${n}: ${documents} documents, ${different} differ, irreducible by clause:`)
  perClause.forEach((hits, index) => {
    if (hits > 0) console.log(`  ${hits}  ${EXPLANATIONS[index]}`)
  })
}
process.exitCode = unexplained > 0 ? 1 : 0
