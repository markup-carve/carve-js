import type { Attrs } from '../ast.js'
import { setOwn } from '../own-property.js'

/**
 * Write a key/value. When another spelling of the name is present the key moves
 * last, so key order tells which spelling was written last (PART 10 §1).
 */
export function writeKeyValue(record: Record<string, string>, key: string, value: string): void {
  const fold = key.toLowerCase()
  if (Object.hasOwn(record, key) && Object.keys(record).some((k) => k !== key && k.toLowerCase() === fold)) delete record[key]
  setOwn(record, key, value)
}

export function mergeAttrs(a: Attrs | undefined, b: Attrs): Attrs {
  if (!a) return b
  const out: Attrs = { ...a }
  // `!== undefined`, not truthiness: an explicit `id=""` in a later block wins
  // over an earlier `#old` (last-wins §15), e.g. `[x]{#old}{id=""}` -> `id=""`.
  if (b.id !== undefined) out.id = b.id
  if (b.classes) out.classes = [...(out.classes ?? []), ...b.classes]
  if (b.keyValues) {
    const keyValues = { ...(out.keyValues ?? {}) }
    for (const [key, value] of Object.entries(b.keyValues)) writeKeyValue(keyValues, key, value)
    out.keyValues = keyValues
  }
  // Merge source order: keep `a`'s order, append `b`'s new slots (a slot
  // already present keeps its earlier position; values are last-wins via
  // the merges above). §15 + source-order rendering.
  const order = [...attrOrder(a)]
  const seen = new Set(order)
  for (const slot of attrOrder(b)) {
    if (!seen.has(slot)) {
      seen.add(slot)
      order.push(slot)
    }
  }
  if (order.length) out.order = order
  return out
}

/**
 * The id an element's attributes give, reading an `ID` key in any case as the
 * id slot (PART 10 §1): the slot written last wins.
 */
export function authoredIdOf(a: Attrs | undefined): string | undefined {
  const keyValues = a?.keyValues
  if (!keyValues || !Object.keys(keyValues).some((k) => k.toLowerCase() === 'id')) return a?.id
  let id: string | undefined
  const slots = attrOrder(a)
  for (const slot of [...slots, ...(slots.includes('#id') ? [] : ['#id'])]) {
    if (slot === '#id') id = a.id ?? id
    else if (slot.toLowerCase() === 'id' && keyValues[slot] !== undefined) id = keyValues[slot]
  }
  return id
}

/** The attribute slots of `a` in order (its `order`, or a derived default). */
function attrOrder(a: Attrs): string[] {
  if (a.order) return a.order
  const o: string[] = []
  if (a.classes?.length) o.push('.class')
  if (a.id !== undefined) o.push('#id')
  if (a.keyValues) for (const k of Object.keys(a.keyValues)) o.push(k)
  return o
}



const accumulatedOrder = new WeakMap<Attrs, Set<string>>()

/** Fold parser-owned consecutive blocks without copying the accumulated prefix. */
export function accumulateAttrs(a: Attrs | undefined, b: Attrs): Attrs {
  if (!a) return b
  let out = a
  let seen = accumulatedOrder.get(out)
  if (!seen) {
    out = { ...a }
    if (a.classes) out.classes = [...a.classes]
    if (a.keyValues) out.keyValues = { ...a.keyValues }
    out.order = [...attrOrder(a)]
    seen = new Set(out.order)
    accumulatedOrder.set(out, seen)
  }
  if (b.id !== undefined) out.id = b.id
  if (b.classes) {
    const classes = (out.classes ??= [])
    for (const name of b.classes) classes.push(name)
  }
  if (b.keyValues) {
    const values = (out.keyValues ??= {})
    for (const key of Object.keys(b.keyValues)) writeKeyValue(values, key, b.keyValues[key]!)
  }
  for (const slot of attrOrder(b)) {
    if (!seen.has(slot)) {
      seen.add(slot)
      out.order!.push(slot)
    }
  }
  return out
}

// carve#3975: only the block run merged into a promoted image is a dropped
// block attribute in Markdown; the image's glued attributes follow the inline rule.
// The run applies only while the image's attributes are the parsed ones, so a
// caller's tree or a later edit keeps the whole-set check.
const promotedImageBlockRuns = new WeakMap<{ attrs?: Attrs }, { run: Attrs; parsed: string }>()

export function recordPromotedImageBlockRun(image: { attrs?: Attrs }, run: Attrs): void {
  promotedImageBlockRuns.set(image, { run, parsed: JSON.stringify(image.attrs ?? {}) })
}

export function promotedImageBlockRun(image: { attrs?: Attrs }): Attrs | undefined {
  const record = promotedImageBlockRuns.get(image)
  return record && record.parsed === JSON.stringify(image.attrs ?? {}) ? record.run : undefined
}
