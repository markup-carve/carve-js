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

/**
 * Reserved without an inventory row (§13a): no writer emits it and every
 * importer consumes it, so an authored one cannot survive a round trip.
 */
export const RETIRED_SOURCE_CARRIER = 'data-carve-src'

/** `data-carve-id-slot`: a run of decimal digits (§13a). */
export const RE_ID_SLOT = /^[0-9]+$/

/** The carriers a writer can emit under the reserved prefix, without it. */
const PREFIXED = [
  'explicit-id',
  'ref',
  'autolink',
  'footnote-label',
  'inline-footnote',
  'col-widths',
  'label',
  'raw',
  'escaped',
  'abbreviations',
  'generated-id',
  'id-slot',
  'tight',
] as const

export type PrefixedCarrier = (typeof PREFIXED)[number]

/** The canonical spelling a writer emits. */
export const carrier = (name: PrefixedCarrier): string => `data-carve-${name}`

/** The deprecated spelling an importer still reads. */
export const legacyCarrier = (name: PrefixedCarrier): string => `data-djot-${name}`

/**
 * Every name reserved on import, canonical and deprecated, lowercase.
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
  // Verbatim-source names remain reserved on import but are excluded from §13a export.
  RETIRED_SOURCE_CARRIER,
  'data-djot-src',
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

export function isReservedExportName(key: string): boolean {
  const name = key.toLowerCase()
  return name === CARRIER_MARKER || name === CARRIER_CHAR || name === RETIRED_SOURCE_CARRIER
    || name === 'data-djot-src' || PREFIXED.some((entry) => carrier(entry) === name || legacyCarrier(entry) === name)
}

export function reportReservedAuthoredNames(
  tree: unknown,
  inlineTypes: ReadonlySet<string>,
  opts: RenderLossSinkOptions,
): void {
  if (!opts.onRenderLoss) return
  const seen = new Set<object>()
  const visit = (value: unknown, inline: boolean, position?: Position): void => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, inline, position)
      return
    }
    const node = value as { type?: unknown; pos?: Position; keyValues?: Attrs['keyValues'] }
    const within = typeof node.type === 'string' ? inlineTypes.has(node.type) : inline
    for (const key of Object.keys(node.keyValues ?? {})) {
      if (!isReservedExportName(key)) continue
      opts.onRenderLoss!({
        code: 'carrier-attribute-dropped',
        target: 'html',
        nodeType: within ? 'inline' : 'block',
        attribute: key,
        message: `Dropped the authored attribute ${key}: the name is reserved for roundtrip import`,
        ...(position ? { pos: position } : {}),
      })
    }
    const entries = Object.entries(value)
    for (const [key, child] of entries) {
      if (key === 'attrs' || key.endsWith('Attrs')) visit(child, within, node.pos ?? position)
    }
    for (const [key, child] of entries) {
      if (key !== 'attrs' && !key.endsWith('Attrs') && key !== 'pos' && key !== 'keyValues') visit(child, within, node.pos ?? position)
    }
    if (node.keyValues && node.type === undefined) seen.delete(value)
  }
  visit(tree, false)
}
