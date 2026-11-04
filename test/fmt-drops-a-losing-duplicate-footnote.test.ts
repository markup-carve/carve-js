import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve#5160: a duplicate footnote definition loses to the first (PART 18), so
// its lines have no node. With an erased line in the document the writer took
// them for swallowed text and kept the whole source instead of collecting.
const cases: Array<[string, string, string]> = [
  ['corpus 620-23', '- a\n  [^f]: t\n[^f]: a\n     [r]: /url\n[r][]\n', '- a\n\n[^f]: t\n\n[r]: /url\n'],
  ['top level with a comment line', '[^f]: t\n\n[^f]: a\nb\n\n%% c\n\nx\n', '%% c\n\nx\n\n[^f]: t\n'],
  ['indented continuation', 'p\n\n[^f]: t\n\n[^f]: a\n  more\n\n[r]: /u\n', 'p\n\n[^f]: t\n\n[r]: /u\n'],
  ['loser nested in the winner', 'x[^f]\n\n[^f]: t\n  [^f]: a\n\n%% c\n', 'x[^f]\n\n%% c\n\n[^f]: t\n'],
  ['loser inside a list item', '[^f]: t\n\n- a\n  [^f]: u\n  w\n  [r]: /u\n\n[r][]\n', '- a\n\n[r][]\n\n[^f]: t\n\n[r]: /u\n'],
]

describe('fmt drops a duplicate footnote definition that lost', () => {
  for (const [name, source, expected] of cases) {
    it(name, () => {
      const written = carveToCarve(source)
      expect(written).toBe(expected)
      expect(carveToCarve(written)).toBe(written)
      expect(carveToHtml(written)).toBe(carveToHtml(source))
    })
  }
})
