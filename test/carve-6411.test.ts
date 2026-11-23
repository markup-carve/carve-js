// carve#6411: the rounds of the nested escape probe are bounded by kinds (C2-W-088, C2-W-010).
import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

function nestedLinks(n: number): string {
  return `${'^*[*[[*'.repeat(n)}^*[*x](u)${'^]]](u)'.repeat(n)}\n`
}

describe('the nested escape probe of carve#6411', () => {
  it('C2-W-088: kind rounds keep the reparses of nested links constant', () => {
    for (const n of [146, 584]) {
      const source = nestedLinks(n)
      const tree = parse(source)
      const { output, stats } = writeTreeWithStats(tree, undefined)
      // One reparse per escape made 207 here.
      expect(stats.parses).toBeLessThan(10)
      expect(treesEqual(parse(output.source), tree)).toBe(true)
      expect(format(output.source)).toBe(output.source)
    }
  })

  it('C2-W-125, C2-W-088: a closer that ends a probed node early gives no kind, so bare carets stay bare (CC-1568)', () => {
    const source = '^{^{^{^{^^}\\{^^{^^}^{^^}{^^^^{^^}\\{^{^^^}^}^}^}^}^}\n'
    // Kind `^` from the escape of the closer `^}` escaped every caret run start: `^{^{^{^\{\^\^}\{\^^\{\^\^}\^...`.
    const written = format(source)
    expect(written).toBe('^{^{^{^\\{^\\^}\\{^^\\{^\\^}^\\{^\\^}{^\\^^^\\{^\\^}\\{^{^^^}^}^}^}^}^}\n')
    expect(treesEqual(parse(written), parse(source))).toBe(true)
  })
})
