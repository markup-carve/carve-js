/*
 * `fromAstJson` reports a string argument as a string argument (carve-js#703).
 *
 * The name invites the mistake - it reads as "from AST JSON", and the sibling
 * entry points in the other two engines both take text: carve-php spells it
 * `AstCodec::decodeJson(string $json)`, carve-rs's CLI reads JSON from stdin
 * behind `--from-json`. This one takes the parsed tree.
 *
 * Without the guard the string fell through to the root check, which read its
 * `.type` (undefined on a string) and reported:
 *
 *   AST root type undefined is not "document"; the root is fixed by PART 12 §7
 *
 * The caller's root is `"document"`. The message sent them to look at their
 * tree for a mistake that was in their call.
 *
 * TypeScript callers never saw this - the signature says `AstJsonDocument`.
 */

import { describe, expect, it } from 'vitest'
import { carveToAstJson, fromAstJson, renderHtml } from '../src/index.js'

const SRC = '[click](https://example.com)\n'

/** The serialized tree, as text and as the object the function wants. */
function both(): { text: string; tree: unknown } {
  const produced = carveToAstJson(SRC)
  const text = typeof produced === 'string' ? produced : JSON.stringify(produced)

  return { text, tree: JSON.parse(text) }
}

describe('fromAstJson argument shape', () => {
  it('names the real mistake when handed a JSON string', () => {
    const { text } = both()
    expect(() => fromAstJson(text as never)).toThrow(TypeError)
    expect(() => fromAstJson(text as never)).toThrow(/not a JSON string/)
  })

  it('does not blame the document root, which is correct', () => {
    const { text } = both()
    // The string's own text contains `"type": "document"`, so a message about
    // the root type is not merely unhelpful here - it is false.
    expect(text).toContain('"document"')
    expect(() => fromAstJson(text as never)).not.toThrow(/root type/)
  })

  it('still ingests the parsed tree', () => {
    const { tree } = both()
    expect(renderHtml(fromAstJson(tree as never)).trim()).toBe(
      '<p><a href="https://example.com">click</a></p>',
    )
  })

  it('still rejects a genuinely wrong root', () => {
    // The check the new arm sits in front of. A foreign payload - ProseMirror's
    // `doc` is the case PART 12 §9 names - must still be turned away as foreign.
    expect(() => fromAstJson({ type: 'doc' } as never)).toThrow(/is not "document"/)
    expect(() => fromAstJson(null as never)).toThrow(/is not "document"/)
  })
})
