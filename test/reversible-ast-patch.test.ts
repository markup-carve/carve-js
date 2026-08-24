import { describe, expect, it } from 'vitest'
import {
  applyReversibleAstPatch,
  applyAstPatch,
  carveToAstJson,
  createReversibleAstPatch,
} from '../src/index.js'

describe('reversible AST patches', () => {
  it('applies forward and inverse changes', () => {
    const before = carveToAstJson('# Before\n\nText.\n')
    const after = carveToAstJson('# After\n\nChanged.\n')
    const patch = createReversibleAstPatch(before, after)
    const applied = applyReversibleAstPatch(before, patch)
    expect(applied).toEqual(applyAstPatch(after, []))
    expect(applyReversibleAstPatch(applied, patch, true)).toEqual(applyAstPatch(before, []))
  })

  it('rejects a stale document', () => {
    const before = carveToAstJson('Before.\n')
    const after = carveToAstJson('After.\n')
    const patch = createReversibleAstPatch(before, after)
    expect(() => applyReversibleAstPatch(carveToAstJson('Other.\n'), patch)).toThrow(/precondition/)
  })
})
