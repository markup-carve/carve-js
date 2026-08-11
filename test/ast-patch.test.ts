import { describe, expect, it } from 'vitest'

import {
  applyAstPatch,
  AstPatchError,
  carveToAstJson,
  createAstPatch,
} from '../src/index.js'

describe('AST patches', () => {
  it('round-trips through JSON and replays the semantic revision', () => {
    const before = carveToAstJson('# Title\n\nSee [docs](/a).\n')
    const after = carveToAstJson('## Title\n\nSee [docs](/b).\n\nAdded.\n')
    const wire = JSON.stringify(createAstPatch(before, after))
    const replayed = applyAstPatch(before, JSON.parse(wire))
    const expected = applyAstPatch(after, [])
    expect(replayed).toEqual(expected)
  })

  it('uses a narrow scalar replacement when the sequence is unchanged', () => {
    const before = carveToAstJson('See [docs](/a).\n')
    const after = carveToAstJson('See [docs](/b).\n')
    const patch = createAstPatch(before, after)
    expect(patch).toEqual([
      expect.objectContaining({ op: 'replace', path: expect.stringContaining('/href'), value: '/b' }),
    ])
  })

  it('does not mutate the input tree', () => {
    const before = carveToAstJson('one\n')
    const snapshot = JSON.stringify(before)
    applyAstPatch(before, createAstPatch(before, carveToAstJson('two\n')))
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('rejects an invalid pointer instead of creating an accidental property', () => {
    const ast = carveToAstJson('one\n')
    expect(() => applyAstPatch(ast, [{ op: 'remove', path: '/missing/value' }])).toThrow(
      AstPatchError,
    )
  })

  it('does not permit a patch path to pollute Object.prototype', () => {
    const ast = carveToAstJson('one\n')
    applyAstPatch(ast, [{ op: 'add', path: '/__proto__', value: { polluted: true } }])
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })

  it('preserves author attributes named like derived metadata', () => {
    const before = carveToAstJson('[Text]{pos=before srcByteLength=before}\n')
    const after = carveToAstJson('[Text]{pos=after srcByteLength=after}\n')
    const replayed = applyAstPatch(before, createAstPatch(before, after))
    expect(JSON.stringify(replayed)).toContain('"pos":"after"')
    expect(JSON.stringify(replayed)).toContain('"srcByteLength":"after"')
  })

  it('rejects a leading-zero array index', () => {
    const ast = carveToAstJson('one\n')
    expect(() => applyAstPatch(ast, [{ op: 'remove', path: '/children/00' }])).toThrow(
      AstPatchError,
    )
  })
})
