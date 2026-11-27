// carve-js#5729: a readback parse that reads nothing but its source keeps its tree for every group that writes the
// same source, and each call still counts as a parse for the repair limit (C2-W-133).
import { describe, expect, it } from 'vitest'
import { format } from '../src/format.ts'
import { readbackParse } from '../src/write-check.ts'
import { createWriter } from '../src/write-state.ts'

describe('writer readback trees (carve-js#5729)', () => {
  it('reuses the tree of a source and charges each call', () => {
    const w = createWriter(null, false)
    const first = readbackParse(w, '\na [b][]\n')
    expect(readbackParse(w, '\na [b][]\n')).toBe(first)
    expect(w.parses).toBe(2)
    expect(w.work.chars).toBe(18)
  })

  it('parses again where link keys take part in the parse', () => {
    const w = createWriter(null, false)
    w.linkKeys = new Set(['b'])
    const first = readbackParse(w, '\na [b][]\n')
    expect(readbackParse(w, '\na [b][]\n')).not.toBe(first)
    expect(w.parses).toBe(2)
  })

  it('writes repeated groups as before', () => {
    const unit = '\\[^[\\`[`[[^]\\[]][]\\[\n\n'
    expect(format(unit.repeat(40))).toBe(`${unit.repeat(40).trimEnd()}\n`)
  })
})
