import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// §11 N1a: a description body spells the boundary between two sibling lists with
// the blank run every host uses. A one-column shift is inside the marker latitude,
// so the next read joins the lists.
describe('two sibling lists in a description body', () => {
  const cases: Array<[string, string]> = [
    [':: t\n:  - a\n\n\n\n   - b\n', ':: t\n: - a\n\n\n\n  - b\n'],
    [':: t\n: 1. a\n\n\n\n  1. b\n  2. c\n', ':: t\n: 1. a\n\n\n\n  1. b\n  2. c\n'],
    ['> :: t\n> : - a\n>\n>\n>\n>   - b\n', '> :: t\n> : - a\n>\n>\n>\n>   - b\n'],
    ['- x\n\n  :: t\n  : - a\n\n\n\n    - b\n', '- x\n\n  :: t\n  : - a\n\n\n\n    - b\n'],
  ]
  for (const [source, written] of cases) {
    it(`stay two lists: ${JSON.stringify(source)}`, () => {
      expect(carveToCarve(source)).toBe(written)
      expect(carveToHtml(written)).toBe(carveToHtml(source))
      expect(carveToHtml(source).split('<dd>')[1]!.match(/<[uo]l>/g)).toHaveLength(2)
      expect(carveToCarve(written)).toBe(written)
    })
  }
})
