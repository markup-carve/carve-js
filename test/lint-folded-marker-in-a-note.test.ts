import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const folded = (source: string): string[] => lintCarve(source)
  .filter(warning => warning.rule === 'list-marker-without-blank-line')
  .map(warning => `${warning.line}:${warning.column}`)

describe('list-marker-without-blank-line in a footnote body', () => {
  it.each([
    [':: t\n:  [^f]: note\n     - nested\n   tail\n', '3:6'],
    ['. d\n   [^n]: e\n     - a\n', '3:6'],
    ['- > para\n  > [^f]: n\n  >   - sub\ntail[^f]\n', '3:7'],
    ['[^n]: d\n  - para\n    [r]: /u\nx\n\n[r][] [^n]\n', '2:3'],
    [':: t\n: - a\n  [^q]: note\n  - [ ] child\n\nr[^q]\n', '4:3'],
  ])('reports the folded marker line of %j', (source, at) => {
    expect(folded(source)).toEqual([at])
  })

  it('stays quiet for a list a blank separates', () => {
    expect(folded('[^n]: d\n\n  - a\n\nr[^n]\n')).toEqual([])
  })
})
