import { describe, expect, it } from 'vitest'
import { AstJsonSchemaError, citations, fromAstJson, parse, toAstJson } from '../src/index.js'
import { WIRE_VALUE_KINDS } from '../src/wire-fields.js'

/**
 * A property the schema pins with `const` admits ONE value, and that value is
 * checked AT DECODE (PART 12 §12(d)).
 *
 * `scripts/generate-wire-fields.mjs`'s `valueKind` read a bare `const` as no
 * kind at all, so no entry reached `WIRE_VALUE_KINDS` and §12(d) never asked
 * anything about the value. Every const-valued field decoded unchecked and was
 * published again - this engine vouching for a payload it never looked at
 * (markup-carve/carve-js#1418), the same shape as `table.rowGroups` in
 * markup-carve/carve-js#1055.
 *
 * WHY `false` IS NOT A LESSER SPELLING OF ABSENT, which is what makes this a
 * correctness bug rather than a strictness preference. The schema writes `const`
 * exactly where the field's PRESENCE is the fact: `definition_list.loose` is
 * `const: true` because absent means each description derives its own wrapper,
 * so there is no `false` to write and `loose: false` states the OPPOSITE of what
 * the field means. `strong.boldItalic`, `list.bareMarker` and
 * `citation_group.mode` are the same arrangement.
 *
 * ALL FOUR are asserted, not just the one the defect was noticed on. They share
 * a single generated code path, so a fixture covering one would pass while the
 * other three stayed unchecked - and three of them predate the definition-list
 * work that surfaced this.
 */

/** The four `const`-valued properties, and a document whose parse contains each. */
const CONST_FIELDS = [
  { type: 'strong', field: 'boldItalic', legal: true, source: '/*bi*/\n', extensions: [] },
  { type: 'list', field: 'bareMarker', legal: true, source: '. one\n. two\n', extensions: [] },
  {
    type: 'citation_group',
    field: 'mode',
    legal: 'integral',
    source: 'See [@smith2020] here.\n',
    extensions: [citations()],
  },
  { type: 'definition_list', field: 'loose', legal: true, source: ':: t\n:  d\n', extensions: [] },
] as const

/** The parser's own tree for a case, as plain JSON. */
const treeOf = (spec: (typeof CONST_FIELDS)[number]): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(toAstJson(parse(spec.source, { extensions: [...spec.extensions] }))),
  ) as Record<string, unknown>

/** Writes `value` onto every node of `type`, or deletes the field for `undefined`. */
const put = (tree: unknown, type: string, field: string, value: unknown): boolean => {
  let hit = false
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (record.type === type) {
      if (value === undefined) delete record[field]
      else record[field] = value
      hit = true
    }
    Object.values(record).forEach(walk)
  }
  walk(tree)
  return hit
}

describe('a const-valued wire field is checked at decode', () => {
  it.each(CONST_FIELDS)('is generated as a const kind for $type `$field`', (spec) => {
    // The generated artifact is what the decoder consults, so the kind reaching
    // it is the thing under test - not merely that some error is thrown.
    expect(WIRE_VALUE_KINDS[spec.type]?.[spec.field]).toBe(`const:${JSON.stringify(spec.legal)}`)
  })

  it.each(CONST_FIELDS)('refuses the wrong value of the right type on $type `$field`', (spec) => {
    // `false` for a `const: true`, `"bogus"` for a `const: "integral"`. This is
    // the case a `{type: "boolean"}` stand-in would MISS: the type is right and
    // only the value is wrong, so nothing but the const check can see it.
    const wrong = spec.legal === true ? false : 'bogus'
    const tree = treeOf(spec)
    expect(put(tree, spec.type, spec.field, wrong)).toBe(true)

    expect(() => fromAstJson(tree)).toThrow(AstJsonSchemaError)
    expect(() => fromAstJson(tree)).toThrow(
      `"${spec.field}" is ${typeof wrong === 'string' ? 'a string' : 'a boolean'} ` +
        `where the schema requires ${JSON.stringify(spec.legal)}`,
    )
  })

  it.each(CONST_FIELDS)('refuses the wrong type on $type `$field`', (spec) => {
    const wrong = spec.legal === true ? 'nope' : 17
    const tree = treeOf(spec)
    expect(put(tree, spec.type, spec.field, wrong)).toBe(true)

    expect(() => fromAstJson(tree)).toThrow(AstJsonSchemaError)
  })

  it.each(CONST_FIELDS)('never REPUBLISHES an invalid $type `$field`', (spec) => {
    // The republish half, asserted separately: a decode that let the value
    // through would put it back on the wire, so the payload would round-trip
    // through this engine carrying a value the schema calls invalid.
    const wrong = spec.legal === true ? false : 'bogus'
    const tree = treeOf(spec)
    put(tree, spec.type, spec.field, wrong)

    let republished: string | undefined
    try {
      republished = JSON.stringify(toAstJson(fromAstJson(tree)))
    } catch {
      republished = undefined
    }

    expect(republished).toBeUndefined()
    // And stated positively, so this cannot pass by the encoder merely dropping
    // the field: nothing carrying the invalid value leaves the engine.
    expect(republished ?? '').not.toContain(`"${spec.field}":${JSON.stringify(wrong)}`)
  })

  it.each(CONST_FIELDS)('still accepts the legal value and the absent field on $type `$field`', (
    spec,
  ) => {
    // The near-miss a naive fix would also refuse. `const` makes the field
    // OPTIONAL with one legal value, not required - refusing an absent one
    // would reject nearly every tree this engine produces.
    const withConst = treeOf(spec)
    put(withConst, spec.type, spec.field, spec.legal)
    expect(() => fromAstJson(withConst)).not.toThrow()

    const without = treeOf(spec)
    put(without, spec.type, spec.field, undefined)
    expect(() => fromAstJson(without)).not.toThrow()
  })

  it.each(CONST_FIELDS)("accepts this engine's own parser output for $type", (spec) => {
    // §9(a): an ingest may never refuse a tree this engine's own encoder wrote.
    expect(() => fromAstJson(treeOf(spec))).not.toThrow()
  })

  it('does not restate §12(c) by giving `type` a const kind', () => {
    // Every node's `type` is a `const` in the schema, so the new case would
    // claim all of them. `collect` skips `type` deliberately: §12(c) rules on a
    // node's type with its own error, and two producers of one rule is the
    // hazard. If this ever fails, a `type` mismatch has silently changed which
    // error it raises.
    for (const kinds of Object.values(WIRE_VALUE_KINDS)) {
      expect(kinds).not.toHaveProperty('type')
    }
  })
})
