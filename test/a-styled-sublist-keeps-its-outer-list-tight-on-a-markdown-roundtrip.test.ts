import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToMarkdown, migrateMarkdown } from '../src/index.js'

// The export writes a blank line around a list-style marker; the import reads
// looseness without it, so a tight outer list comes back tight.
const roundtrip = (source: string): string => migrateMarkdown(carveToMarkdown(source, { roundtrip: true })).value

describe('a styled sublist keeps its outer list tight on a Markdown roundtrip', () => {
  it.each([
    ['a lettered sublist', '- first\n\n  a. one\n  b. two\n- second\n'],
    ['a roman sublist', '- x\n\n  i. one\n  ii. two\n- y\n'],
    ['after a continued paragraph', '- first\n  more\n\n  a. one\n  b. two\n- second\n'],
    ['around a loose sublist', '- first\n\n  a. one\n\n  b. two\n- second\n'],
  ])('%s', (_name, source) => {
    expect(carveToHtml(roundtrip(source))).toBe(carveToHtml(source))
  })

  it('a loose outer list stays loose', () => {
    const source = '- first\n\n  a. one\n  b. two\n\n- second\n'
    expect(carveToHtml(roundtrip(source))).toBe(carveToHtml(source))
    expect(carveToHtml(source)).toContain('<p>second</p>')
  })
})
