/*
 * The HTML roundtrip carrier inventory (PART 10 §13, §13a).
 *
 * The names here are the whole reserved set: §13a reserves an ENUMERATION, not
 * a prefix pattern, which is why `data-marker` and `data-char` sit in the same
 * list as the prefixed ones.
 *
 * Writers emit `data-carve-*`. Importers also accept the `data-djot-*`
 * spelling, which released carve-php versions wrote, so a document exported
 * before the rename keeps round-tripping (markup-carve/carve#2902 ruling 0).
 */

import type { Attrs, Position } from './ast.js'
import type { RenderLossSinkOptions } from './render-loss.js'

/**
 * The bound on a separator width, on BOTH sides of `data-carve-col-widths`
 * (PART 10 §13a, [CARVE-P10-016]).
 *
 * The widths arrive comma-joined in an attribute an importer reads off
 * UNTRUSTED HTML and the writer spells one `-` per unit, so six characters of
 * attribute buy a megabyte of separator row. A reader REFUSES the whole carrier
 * past this - not a clamp and not a partial read, both of which put a separator
 * row on the page whose widths nobody wrote - and a writer writes no carrier at
 * all, because a carrier a conforming reader will refuse is a round-trip
 * promise it cannot keep.
 *
 * `table.separatorWidths` itself has NO upper bound: a parse records what the
 * author typed, and an author who types a thousand dashes has already paid for
 * them. The amplification is the carrier's alone.
 *
 * 1000 is a round number chosen so the engines agree on the bytes, not derived
 * from anything.
 */
export const MAX_CARRIED_SEPARATOR_WIDTH = 1000

/** A carrier whose own spelling is not under the reserved prefix (§13a, ruling 3). */
export const CARRIER_MARKER = 'data-marker'
export const CARRIER_CHAR = 'data-char'

/** The carriers under the reserved prefix, without it. */
const PREFIXED = [
  'explicit-id',
  'ref',
  'autolink',
  'footnote-label',
  'inline-footnote',
  'col-widths',
  'raw',
  'escaped',
  'src',
  'abbreviations',
] as const

export type PrefixedCarrier = (typeof PREFIXED)[number]

/** The canonical spelling a writer emits. */
export const carrier = (name: PrefixedCarrier): string => `data-carve-${name}`

/** The deprecated spelling an importer still reads. */
export const legacyCarrier = (name: PrefixedCarrier): string => `data-djot-${name}`

/**
 * Every name the inventory reserves, canonical and deprecated, lowercase.
 *
 * An importer tests membership here to decide that a name is the serializer's
 * protocol rather than the author's content: ruling 5 says `safe` import
 * consumes the inventory and never writes a reserved name back out, so the
 * deprecated spellings have to be in the set too.
 */
export const RESERVED_CARRIER_ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  CARRIER_MARKER,
  CARRIER_CHAR,
  ...PREFIXED.map(carrier),
  ...PREFIXED.map(legacyCarrier),
])

/**
 * Read a carrier off an element, canonical spelling first.
 *
 * `undefined` means the element carries neither spelling. An empty string is a
 * real value: a presence carrier is written as `name` or `name="1"`, and §13a
 * says a reader reads presence and does not compare the value.
 */
export function readCarrier(
  get: (name: string) => string | undefined,
  name: PrefixedCarrier,
): string | undefined {
  return get(carrier(name)) ?? get(legacyCarrier(name))
}

export const roundtripExport = (opts: { roundtrip?: boolean }): boolean => opts.roundtrip === true

/**
 * An authored attribute colliding with a carrier is DROPPED, and the drop is
 * reported (ruling 1).
 *
 * Emitting both is what carve-php does today and it is invalid HTML; refusing
 * the export was the alternative, and it lets one authored attribute veto a
 * mode the caller asked for. Only the carriers this element actually writes are
 * passed in, so an authored `data-marker` on a `<p>` is ordinary content.
 */
export function dropCollidingAuthored(
  attrs: Attrs | undefined,
  names: readonly string[],
  opts: RenderLossSinkOptions,
  node: { type: string; pos?: Position },
  nodeType: 'block' | 'inline',
): Attrs | undefined {
  if (!attrs?.keyValues) return attrs
  let next = attrs
  for (const name of names) {
    const match = Object.keys(next.keyValues ?? {}).find((key) => key.toLowerCase() === name)
    if (match === undefined) continue
    const { [match]: _dropped, ...keyValues } = next.keyValues!
    next = { ...next, keyValues, ...(next.order ? { order: next.order.filter((slot) => slot !== match) } : {}) }
    opts.onRenderLoss?.({
      code: 'carrier-attribute-dropped',
      target: 'html',
      nodeType,
      attribute: match,
      message: `Dropped the authored attribute ${match}: the roundtrip carrier of the same name owns it`,
      ...(node.pos ? { pos: node.pos } : {}),
    })
  }
  return next
}
