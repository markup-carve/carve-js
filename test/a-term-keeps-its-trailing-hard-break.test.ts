import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// A term is one line (markup-carve/carve#4861), so a trailing backslash is a hard break the writer keeps (#4258).
describe('a definition term keeps its trailing hard break', () => {
  it.each([
    [':: t\\\n: d\n', ':: t\\\n: d\n'],
    [':: t \\\n: d\n', ':: t \\\n: d\n'],
    ['- x\n  :: t\\\n  : d\n', '- x\n  :: t\\\n  : d\n'],
    // A comment after a term is the description's first block (carve#5167).
    [':: t\\\n%% c\n: d\n', ':: t\\\n: %% c\n\n  d\n'],
    [':: t\\\\\\\n: d\n', ':: t\\\\\\\n: d\n'],
    [':: t\\\\\n: d\n', ':: t\\\\\n: d\n'],
  ])('%j', (source, written) => {
    const output = carveToCarve(source)
    expect(output).toBe(written)
    expect(carveToHtml(output)).toBe(carveToHtml(source))
  })
})
