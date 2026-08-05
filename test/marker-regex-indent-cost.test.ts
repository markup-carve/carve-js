import { describe, it, expect } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'

/*
 * carve-js#641, following the residual past the writer and into the PARSER.
 *
 * The list-marker patterns begin with a greedy `([^\S ]*)` so they tolerate
 * indentation. On a line they do NOT match, that prefix BACKTRACKS: the engine
 * gives back one whitespace character at a time and retries every marker
 * alternation at each position. Measured on `RE_ORDERED` against a `- x` line:
 *
 *     indent   0     20 ns/call
 *     indent 200   1059 ns/call
 *     indent 400   2055 ns/call
 *
 * Deeply indented lines are exactly where these run most - a nested list tests
 * every marker shape on every line at every level - so it dominated: 15% of the
 * whole parse of a 200-level ladder.
 *
 * The prefix is now ATOMIC, via the `(?=(...))\1` idiom, which is
 * semantics-preserving here for a reason worth writing down: every alternation
 * after the prefix starts with a NON-whitespace character, so a shorter
 * whitespace run can never let the rest of the pattern match. Backtracking into
 * it could only ever fail.
 *
 * These tests pin the marker patterns' BEHAVIOUR at a range of indents, which is
 * what an atomic-group change could plausibly break, and the group numbering the
 * idiom has to preserve. The speed itself is not asserted - a ratio bound tight
 * enough to catch its loss would flake on a loaded machine, which is the
 * observation that produced #641.
 */
describe('marker recognition is unchanged at every indent', () => {
  const at = (indent: number, line: string) => ' '.repeat(indent) + line

  it('recognizes a bullet at any indent', () => {
    for (const n of [0, 1, 2, 3, 8, 40]) {
      expect(carveToHtml(at(n, '- x\n')), `indent ${n}`).toContain('<li>x</li>')
    }
  })

  it('recognizes every ordered dialect at any indent', () => {
    for (const n of [0, 2, 5, 40]) {
      for (const marker of ['1.', '1)', 'iv.', 'A.', 'x.', '.']) {
        expect(carveToHtml(at(n, `${marker} x\n`)), `${marker} at ${n}`).toContain('<li>x</li>')
      }
    }
  })

  it('recognizes a task marker at any indent', () => {
    for (const n of [0, 2, 40]) {
      expect(carveToHtml(at(n, '- [x] x\n')), `indent ${n}`).toContain('checked')
    }
  })

  it('still rejects the shapes that are not markers', () => {
    // A marker needs content, and `) ` is never a bare ordered marker.
    for (const n of [0, 2, 40]) {
      expect(carveToHtml(at(n, '-\n')), `indent ${n}`).not.toContain('<li>')
      expect(carveToHtml(at(n, ') x\n')), `indent ${n}`).not.toContain('<li>')
      expect(carveToHtml(at(n, '-x\n')), `indent ${n}`).not.toContain('<li>')
    }
  })

  it('keeps the indent capture, which the marker width depends on', () => {
    // The idiom puts the lookahead's group in slot 1, holding the same indent the
    // plain capture did. If that shifted, nesting would be measured from the
    // wrong column - so a nested ladder is the observable.
    const src = '- a\n  - b\n    - c\n'
    expect(carveToHtml(src)).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <ul>\n          <li>c</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('parses a deep ladder to the depth it was written at', () => {
    const depth = 60
    const src = Array.from({ length: depth }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n') + '\n'
    // An item holds its paragraph FIRST and the sub-list after it, so the walk
    // looks for a list among the item's children rather than at a fixed slot.
    let node: unknown = parse(src).children[0]
    let seen = 0
    while (node && (node as { type: string }).type === 'list') {
      seen++
      const kids = (node as { items?: { children?: { type: string }[] }[] }).items?.[0]?.children
      node = kids?.find((child) => child.type === 'list')
    }
    expect(seen).toBe(depth)
  })
})
