import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const folded = (source: string): string[] => lintCarve(source)
  .filter(warning => warning.rule === 'list-marker-without-blank-line')
  .map(warning => `${warning.line}:${warning.column}`)

// A marker opens a list in a footnote body as in an item, so nothing folds there (PART 0 S3, carve#4860).
describe('list-marker-without-blank-line in a footnote body', () => {
  it.each([
    ':: t\n:  [^f]: note\n     - nested\n   tail\n',
    '. d\n   [^n]: e\n     - a\n',
    '- > para\n  > [^f]: n\n  >   - sub\ntail[^f]\n',
    '[^n]: d\n  - para\n    [r]: /u\nx\n\n[r][] [^n]\n',
    ':: t\n: - a\n  [^q]: note\n  - [ ] child\n\nr[^q]\n',
  ])('stays quiet for the list a marker opens in %j', (source) => {
    expect(folded(source)).toEqual([])
  })

  it.each([
    ['[^n]: d\n  > p\n  > - x\n\nr[^n]\n', '3:5'],
    ['[^n]: ::: w\n  p\n  - x\n  :::\n\nr[^n]\n', '3:3'],
  ])('reports a marker folded into a quote or div paragraph in the note: %j', (source, at) => {
    expect(folded(source)).toEqual([at])
  })

  it('stays quiet for a list a blank separates', () => {
    expect(folded('[^n]: d\n\n  - a\n\nr[^n]\n')).toEqual([])
  })
})
