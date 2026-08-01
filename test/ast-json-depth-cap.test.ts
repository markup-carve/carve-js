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
