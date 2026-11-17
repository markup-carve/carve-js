import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-119 C2-I-047: nested bracket text in an inline note', () => {
  const source = '^[/[^[g]/] b/]\n'

  it('escapes the inner bracket run inside a braced emphasis span', () => {
    const result = upgrade(source)
    expect(result.output).toBe('^[{/\\[\\^[g]\\/\\] b/}]\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-257')
  })

  it('keeps an unrelated table difference as a mismatch', () => {
    const result = upgrade(`${source}\n{valigns=top,bottom widths=40}\n| a | b | c |`)
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('keeps a closing brace literal inside a braced insert', () => {
    const result = upgrade('^[{+[^[g]+}] b+}]\n')
    expect(result.output).toBe('^[{+\\[\\^[g]\\+\\}\\] b+}]\n')
    expect(result.check).toBe('pass')
  })

  it('uses the observed label and tail rather than one fixture string', () => {
    const result = upgrade('^[/[^[h]/] c/]\n')
    expect(result.output).toBe('^[{/\\[\\^[h]\\/\\] c/}]\n')
    expect(result.check).toBe('pass')
  })

  it('leaves a matching code span alone while rewriting the real note', () => {
    const result = upgrade('`^[/[^[g]/] b/]` ^[/[^[h]/] c/]\n')
    expect(result.output).toBe('`^[/[^[g]/] b/]` ^[{/\\[\\^[h]\\/\\] c/}]\n')
    expect(result.check).toBe('pass')
  })
})
