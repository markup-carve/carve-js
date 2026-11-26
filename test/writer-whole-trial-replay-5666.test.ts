import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics } from '../src/index.ts'

const paragraph = '[a *[a][]*[x]: /u\n'.repeat(122)

// C2-W-125 (carve-js#5666): a pass without `wholeTrials` tests the trials it reads the switch for. Where none would give
// the tree, the pass with the switch takes its result, as here: each paragraph reads it once per pass.
describe('C2-W-125: a whole-trial pass whose trials give no tree takes the earlier pass (carve-js#5666)', () => {
  it.each([1, 4])('%i paragraphs of 122 lines read back as written', (count) => {
    const source = Array<string>(count).fill(paragraph).join('\n')
    const out = formatWithDiagnostics(source)
    expect(out.diagnostics).toEqual([])
    expect(out.source).toBe(source)
  })
})
