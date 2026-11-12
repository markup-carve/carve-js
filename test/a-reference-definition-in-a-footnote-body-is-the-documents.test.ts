import { describe, expect, it } from 'vitest'
import { markdownToCarve, migrateMarkdown } from '../src/index.js'

// carve-js#4990: a definition in a footnote body is the document's, so it is
// written in Carve's spelling and a denied one is dropped there too.

describe('a reference definition in a footnote body', () => {
  it.each([
    ['a pointy denied destination', '<javascript:x>'],
    ['an entity-encoded denied destination', 'javascript&colon;x'],
  ])('drops %s with one warning', (_name, destination) => {
    const markdown = `a[^1]\n\n[^1]: [x][r]\n\n    [r]: ${destination}\n`
    expect(markdownToCarve(markdown)).toBe('a[^1]\n\n[^1]: x\n')
    expect(migrateMarkdown(markdown).report.diagnostics.filter((row) => row.code === 'attribute-dropped').map((row) => row.message))
      .toEqual(['Dropped a reference definition with a denied URL scheme'])
  })

  it('writes an allowed destination as Carve reads it', () => {
    expect(markdownToCarve('a[^1]\n\n[^1]: [x][r]\n\n    [r]: <https://e>\n'))
      .toBe('a[^1]\n\n[^1]: [x][r]\n\n[r]: https://e\n')
  })
})
