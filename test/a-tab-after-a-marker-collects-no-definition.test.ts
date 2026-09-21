import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * `unordered_item`, `ordered_item` and `task_marker` all spell their separator
 * `space`, and `space = ' '` (PART 1). A tab does not satisfy it, so a marker
 * followed by one opens nothing and its line is ordinary text.
 *
 * The definition prepass strips container prefixes to decide what column a line
 * sits at, and its strip spelled the separator `[ \t]+`. So it handed the
 * collector an item's content view of a line the block parser reads as a
 * paragraph: `-<TAB>[t]: /t` printed AND resolved elsewhere, which is the one
 * thing no construct in the language does (markup-carve/carve-js#1870).
 */
describe('a tab after a marker collects no definition', () => {
  const leaks: [string, string][] = [
    ['a bullet', '-\t[t]: /t\n\n[x][t]\n'],
    ['the other bullet', '*\t[t]: /t\n\n[x][t]\n'],
    ['a dotted ordered marker', '1.\t[t]: /t\n\n[x][t]\n'],
    ['a parenthesized ordered marker', '1)\t[t]: /t\n\n[x][t]\n'],
  ]

  for (const [name, source] of leaks) {
    // Asserted as the WHOLE rendering. "The reference does not resolve" also
    // describes an engine that dropped the marker line, and the point is that
    // the author's line survives as text while defining nothing.
    it(`leaves the line as text and defines nothing: ${name}`, () => {
      const marker = source.slice(0, source.indexOf('\t'))
      expect(carveToHtml(source)).toBe(`<p>${marker}\t[t]: /t</p>\n<p>[x][t]</p>`)
    })
  }

  it('the task box takes a space too', () => {
    // `- ` opens the item, so the box is the item's content rather than a task
    // marker, and the definition behind it is that text as well.
    expect(carveToHtml('- [ ]\t[t]: /t\n\n[x][t]\n')).toBe(
      '<ul>\n  <li>[ ]\t[t]: /t</li>\n</ul>\n<p>[x][t]</p>',
    )
  })

  const kept: [string, string, string][] = [
    ['a bullet and a space', '- [t]: /t\n\n[x][t]\n', '<ul>\n  <li></li>\n</ul>\n<p><a href="/t">x</a></p>'],
    [
      'a task box and a space',
      '- [ ] [t]: /t\n\n[x][t]\n',
      '<ul>\n  <li><input type="checkbox" disabled> </li>\n</ul>\n<p><a href="/t">x</a></p>',
    ],
  ]

  for (const [name, source, expected] of kept) {
    // The control: the separator is what changed, not the collection. A fix
    // written as "do not collect behind a marker" passes every row above.
    it(`still collects behind the space spelling: ${name}`, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }

  it('a tab is still indentation in the leading run', () => {
    // PART 7 makes a tab syntax in exactly one place, and the strip keeps it
    // there: a definition behind a TAB-INDENTED bullet is still collected, the
    // same as behind a space-indented one.
    expect(carveToHtml('\t- [t]: /t\n\n[x][t]\n')).toBe(
      '<ul>\n  <li></li>\n</ul>\n<p><a href="/t">x</a></p>',
    )
    expect(carveToHtml('  - [t]: /t\n\n[x][t]\n')).toBe(
      '<ul>\n  <li></li>\n</ul>\n<p><a href="/t">x</a></p>',
    )
  })
})
