import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

describe('a flag after spaced opening punctuation (carve#4813)', () => {
  it.each([
    ['use (--force) or "--force" or [--force] or --force\n', '<p>use (--force) or “--force” or [--force] or --force</p>'],
    ["try '--help' and (--verbose)\n", '<p>try ‘--help’ and (--verbose)</p>'],
    ['range (1--10) and a(--x)\n', '<p>range (1–10) and a(–x)</p>'],
    ['(--x) and (--y)\n', '<p>(--x) and (--y)</p>'],
  ])('%s', (source, expected) => {
    expect(html(source)).toBe(expected)
  })
})
