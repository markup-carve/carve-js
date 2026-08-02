import { describe, expect, it } from 'vitest'
import {
  AstJsonDepthError,
  MAX_AST_JSON_DEPTH,
  fromAstJson,
  parse,
  resolve,
  toAstJson,
} from '../src/index.js'
import { MAX_NESTING_DEPTH } from '../src/parse.js'

/** `k` nested containers, each fence one colon wider than the one inside it. */
function nestedContainers(k: number): string {
  let s = ''
  for (let i = 0; i < k; i++) s += ':'.repeat(k - i + 2) + ` d${i}\n\n`
  s += 'X\n\n'
  for (let i = k - 1; i >= 0; i--) s += ':'.repeat(k - i + 2) + '\n\n'
  return s
}

/** A payload nesting `n` divs directly, bypassing the parser's own cap. */
function wrapped(n: number): ReturnType<typeof toAstJson> {
  let node: unknown = { type: 'paragraph', children: [{ type: 'text', value: 'X' }] }
  for (let i = 0; i < n; i++) node = { type: 'div', children: [node] }
  return { type: 'document', srcByteLength: 0, children: [node] } as ReturnType<typeof toAstJson>
}

/** `k` nested list levels - two AST nodes per level, the worst shape there is. */
function nestedList(k: number): string {
  return Array.from({ length: k }, (_, i) => '  '.repeat(i) + '- x').join('\n') + '\n'
}

describe('fromAstJson depth cap', () => {
  it('ingests anything the parser can emit, at the parser own limit', () => {
    // The test that would have caught carve-rs#389: a reader whose budget is
    // confused with the parser's rejects the engine's own output.
    for (const k of [40, 100, 199, 200]) {
      const json = toAstJson(resolve(parse(nestedContainers(k))))
      expect(() => fromAstJson(json), `round trip at ${k} containers`).not.toThrow()
    }
  })

  it('ingests the shape that costs the most per level, not just the cheapest', () => {
    // Containers cost one node per level and lists cost two, so a cap set from
    // the container measurement passes the test above and still rejects a list
    // the parser just produced. That is how `MAX_NESTING_DEPTH + 8` survived
    // review: every shape it was tried against was the cheap one.
    for (const k of [40, 100, 199, 200]) {
      const json = toAstJson(resolve(parse(nestedList(k))))
      expect(() => fromAstJson(json), `round trip at ${k} list levels`).not.toThrow()
    }
  })

  it('measures depth in time linear in the tree, not exponential', () => {
    // The probe pushed `items` twice - once from CHILD_FIELDS and once
    // explicitly - so every list level walked its subtree twice and the cost
    // compounded to 2^depth: 20 levels took 1.9 s and 200 never finished. A
    // guard against deep input that is itself exponential in depth IS the
    // denial of service it exists to prevent, so the shape is pinned by cost.
    const start = Date.now()
    fromAstJson(toAstJson(resolve(parse(nestedList(MAX_NESTING_DEPTH)))))
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('is derived from the parser cap, not a number of its own', () => {
    // A constant that happens to be big enough today stops being big enough the
    // moment MAX_NESTING_DEPTH moves. PART 12 section 9 asks for the arithmetic.
    expect(MAX_AST_JSON_DEPTH).toBeGreaterThanOrEqual(MAX_NESTING_DEPTH * 2)
  })

  it('refuses deeper input with its own error, not a RangeError', () => {
    // Before this cap, 2000 levels surfaced `RangeError: Maximum call stack size
    // exceeded` at a depth that varied by engine and by the caller's stack use.
    for (const n of [500, 2000, 5000]) {
      expect(() => fromAstJson(wrapped(n))).toThrow(AstJsonDepthError)
    }
  })

  it('reports the depth it measured and the cap it applied', () => {
    try {
      fromAstJson(wrapped(5000))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(AstJsonDepthError)
      expect((error as AstJsonDepthError).depth).toBeGreaterThan(MAX_AST_JSON_DEPTH)
      expect((error as Error).message).toContain(String(MAX_AST_JSON_DEPTH))
    }
  })

  it('still decodes an ordinary shallow document', () => {
    // The cap cannot pass by refusing everything.
    const json = toAstJson(resolve(parse('> - /a *b*/\n')))
    expect(() => fromAstJson(json)).not.toThrow()
  })
})
