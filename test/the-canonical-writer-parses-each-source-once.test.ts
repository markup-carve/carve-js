import { afterEach, describe, expect, it, vi } from 'vitest'
import { carveToCarve } from '../src/index.js'
import { ParseSession } from '../src/parse.js'

// carve-js#5023, #5024: the writer's own parse is also its readback, so a commented document
// parses its source once and its candidate once.
describe('the canonical writer parses each source once', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const topLevelParses = (source: string): number[] => {
    const parse = ParseSession.prototype.parse
    const sizes: number[] = []
    let depth = 0
    vi.spyOn(ParseSession.prototype, 'parse').mockImplementation(function (this: ParseSession, ...args: Parameters<typeof parse>) {
      if (depth === 0) sizes.push(args[0].length)
      depth++
      try {
        return parse.apply(this, args)
      } finally {
        depth--
      }
    })
    carveToCarve(source)
    return sizes
  }

  it.each([
    ['line comments', '%% line comment 1\nVisible text 1 %% trailing comment\n\n%% line comment 2\nVisible text 2\n'],
    ['block comments', '%%%\nblock comment 1\nsecond line\n%%%\n\nVisible paragraph 1.\n\n%%%\nblock comment 2\n%%%\n\nVisible paragraph 2.\n'],
  ])('parses a document with %s at most twice', (_label, source) => {
    expect(topLevelParses(source).length).toBeLessThanOrEqual(2)
  })
})
