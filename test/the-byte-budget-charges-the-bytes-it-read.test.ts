import { describe, expect, it } from 'vitest'
import { expandIncludes, parse, type IncludeResolver } from '../src/index.js'

/**
 * PART 9 section 19, ported from markup-carve/carve-php#1953: the byte budget
 * counts bytes READ, not bytes admitted into the expansion.
 *
 * The budget bounds the expanded OUTPUT and explicitly not the work done to
 * produce it, "because a target is resolved before its size is known". So the
 * read of the target that breaks the budget is unavoidable at this seam, the
 * specification names and accepts it, and a total that omitted it could not
 * tell "read nothing" from "read a target and refused it".
 */
function expand(entry: string, files: Record<string, string>, maxBytes: number) {
  const calls: string[] = []
  const resolve: IncludeResolver = (request) => {
    calls.push(request)
    const source = files[request]

    return source === undefined ? null : { source, id: request }
  }
  const result = expandIncludes(parse(entry), entry, { resolve, maxDepth: 8, maxBytes })

  return { calls, chargedBytes: result.chargedBytes, rules: result.warnings.map((w) => w.rule) }
}

describe('the byte budget charges the bytes it read', () => {
  it('charges across the transitive graph, the refused target included', () => {
    const measured = expand('{{ a }}', { a: '{{ b }}', b: '12345' }, 8)

    expect(measured.chargedBytes).toBe(12)
  })

  it('charges a repeated target per occurrence, the refused one included', () => {
    const measured = expand('{{ a }} {{ a }} {{ a }}', { a: '1234' }, 9)

    expect(measured.chargedBytes).toBe(12)
  })

  it('charges the single target that broke the budget on its own', () => {
    const measured = expand('{{ large }} {{ must-not-read }}', { large: '12345', 'must-not-read': 'secret' }, 4)

    expect(measured.chargedBytes).toBe(5)
  })

  /**
   * The evidence that the accounting moved and the WALK did not. Section 19's
   * "refusal is terminal" rule is a different one, and this change must not
   * touch it: once the budget is spent every later directive is refused
   * WITHOUT being resolved, so `must-not-read` is never asked for.
   */
  it('still refuses every later directive without resolving it', () => {
    const measured = expand('{{ large }} {{ must-not-read }}', { large: '12345', 'must-not-read': 'secret' }, 4)

    expect(measured.calls).toEqual(['large'])
    expect(measured.rules).toEqual(['include-budget', 'include-budget'])
  })

  /**
   * Charging what was read equals charging what was admitted wherever nothing
   * is refused, so the change cannot inflate a total that fits.
   */
  it('charges an expansion that fits exactly what it admitted', () => {
    const measured = expand('{{ a }} {{ b }}', { a: '1234', b: '56' }, 1000)

    expect(measured.chargedBytes).toBe(6)
    expect(measured.rules).toEqual([])
  })

  it('charges nothing when no target is read at all', () => {
    const measured = expand('{{ missing }}', {}, 1000)

    expect(measured.chargedBytes).toBe(0)
    expect(measured.calls).toEqual(['missing'])
  })
})
