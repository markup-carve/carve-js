import { describe, expect, it } from 'vitest'
import {
  AstJsonDepthError,
  MAX_AST_JSON_DEPTH,
  fromAstJson,
  parse,
  resolve,
  toAstJson,
} from '../src/index.js'

/** `k` nested containers, each fence one colon wider than the one inside it. */
function nestedContainers(k: number): string {
  let s = ''
  for (let i = 0; i < k; i++) s += ':'.repeat(k - i + 2) + ` d${i}\n\n`
  s += 'X\n\n'
  for (let i = k - 1; i >= 0; i--) s += ':'.repeat(k - i + 2) + '\n\n'
  return s
}

/** `k` nested list levels - the shape that costs TWO nodes per level. */
function nestedLists(k: number): string {
  return Array.from({ length: k }, (_, i) => ' '.repeat(i * 2) + '- item').join('\n') + '\n'
}

/** A payload nesting `n` divs directly, bypassing the parser's own cap. */
function wrapped(n: number): ReturnType<typeof toAstJson> {
  let node: unknown = { type: 'paragraph', children: [{ type: 'text', value: 'X' }] }
  for (let i = 0; i < n; i++) node = { type: 'div', children: [node] }
  return { type: 'document', srcByteLength: 0, children: [node] } as ReturnType<typeof toAstJson>
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

  it('ingests the shapes that cost more than one node per level', () => {
    // A container ladder is one node per level, so it alone cannot tell whether
    // the cap was derived or guessed. A list is two nodes per level - 402 at the
    // parser's cap of 200 - and it is the shape every engine's first attempt
    // rejected (carve-rs#389, carve-php#556, and the first draft here).
    const shapes: Array<[string, string]> = [
      ['list ladder', nestedLists(200)],
      ['blockquote chain', '> '.repeat(200) + 'x\n'],
      ['table under blockquotes', '> '.repeat(200) + '\n| =a | =b |\n| 1 | 2 |\n'],
    ]
    for (const [name, source] of shapes) {
      const json = toAstJson(resolve(parse(source)))
      expect(() => fromAstJson(json), name).not.toThrow()
      expect(toAstJson(fromAstJson(json)), `${name} decodes to the same AST`).toEqual(json)
    }
  })

  it('refuses deeper input with its own error, not a RangeError', () => {
    // Before this cap, 2000 levels surfaced `RangeError: Maximum call stack size
    // exceeded` at a depth that varied by engine and by the caller's stack use.
    for (const n of [MAX_AST_JSON_DEPTH + 1, 2000, 5000]) {
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

describe('a payload with no nodes in it at all', () => {
  /**
   * An array is a child LIST rather than a level of its own, which is the right
   * way to count NODES - a `children` array should not make a document twice as
   * deep as it reads. But then a payload of nothing but nested arrays measures
   * ZERO nodes, clears the node cap, and the conversion walk recurses over it
   * until the stack gives out. So this shape still raised the `RangeError` that
   * `AstJsonDepthError` exists to replace.
   */
  it('refuses nested arrays with the typed error rather than a RangeError', () => {
    let arrays: unknown = []
    for (let i = 0; i < 200_000; i++) arrays = [arrays]

    let thrown: unknown
    try {
      fromAstJson({ type: 'document', children: arrays } as never)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AstJsonDepthError)
    expect(thrown).not.toBeInstanceOf(RangeError)
  })

  it('still accepts the arrays an ordinary document is made of', () => {
    // The guard has to be loose enough that normal nesting - one array plus one
    // node per level - is nowhere near it.
    const json = toAstJson(parse('- a\n- b\n\n> q\n\n| x |\n'))
    expect(JSON.stringify(toAstJson(fromAstJson(json)))).toBe(JSON.stringify(json))
  })
})

describe('measuring the depth is linear in the payload', () => {
  it('does not double its work per level of a nested list', () => {
    // `items` sits in CHILD_FIELDS, and pushing it a second time doubled the
    // walk for every list level: 2^depth. A 20-deep list took ~900ms and a
    // 30-deep one never returned - a hang reachable with a few hundred bytes.
    const listOfDepth = (n: number) =>
      toAstJson(resolve(parse(Array.from({ length: n }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n') + '\n')))

    // 12 and 22 rather than deeper: the exponential form is ~2^10 times slower
    // here, which FAILS in about a second. At depth 30 it would hang instead,
    // and a hang in CI reads as a broken runner rather than a regression.
    const shallow = listOfDepth(12)
    const deep = listOfDepth(22)

    const time = (json: ReturnType<typeof toAstJson>) => {
      const started = performance.now()
      fromAstJson(json)
      return performance.now() - started
    }
    time(shallow) // warm up

    const shallowMs = Math.max(time(shallow), 0.05)
    const deepMs = time(deep)

    // Doubling the depth doubles the nodes; exponential growth would be ~2^15.
    expect(deepMs / shallowMs).toBeLessThan(50)
  })
})
