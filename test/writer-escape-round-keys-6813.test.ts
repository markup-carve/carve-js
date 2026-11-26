import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

const collapsed = (lines: number): string => '[a *[a][]*[x]: /u\n'.repeat(lines)

// C2-W-075, C2-W-088 (carve#6813): a key loss inside the rounds is provisional; the group is judged with its verbatim
// reference texts, and then with the authored source of its affected leaf blocks.
describe('C2-W-075: a key the escape rounds cannot spell is no loss where the output reads back (carve#6813)', () => {
  it.each([100, 121, 122, 123, 130])('%i lines of collapsed references past the depth cap', (lines) => {
    const source = collapsed(lines)
    const out = formatWithDiagnostics(source)
    expect(out.diagnostics).toEqual([])
    expect(treesEqual(parse(out.source), parse(source))).toBe(true)
  })

  it('full references with a definition and mutated lines read back with no loss', () => {
    const lines = Array.from({ length: 106 }, () => '[a *[a][x]*[x]: /u')
    lines[0] = '[a *[a[x]*[x]: /u'
    lines[11] = '[a *a][x]*[x]: /u'
    lines[25] = '[a *[a][x][x]: /u'
    lines[51] = '[a *[a][x]*[x] /u'
    lines[59] = 'a *[a][x]*[x]: /u'
    const source = `${lines.join('\n')}\n\n[x]: /u\n`
    const out = formatWithDiagnostics(source)
    expect(out.diagnostics).toEqual([])
    expect(treesEqual(parse(out.source), parse(source))).toBe(true)
  })

  it('a supplied tree has no sidecar, so it keeps the loss (C2-W-117)', () => {
    const codes = writeWithDiagnostics(parse(collapsed(122))).diagnostics.map((entry) => entry.code)
    expect(codes.length).toBeGreaterThan(0)
    expect(new Set(codes)).toEqual(new Set(['field-unspellable']))
  })

  it('a tree edited between two writes is written as edited', () => {
    const tree = parse('[a\\*][]\n')
    writeWithDiagnostics(tree)
    const link = (tree.children[0] as { children: { key?: string }[] }).children[0]!
    link.key = 'a\\*x'
    expect(writeWithDiagnostics(tree).source).toBe(writeWithDiagnostics(structuredClone(tree)).source)
  })
})
