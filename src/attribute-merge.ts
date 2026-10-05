import type { Attrs } from './ast.js'

export function mergeAttrs(a: Attrs | undefined, b: Attrs): Attrs {
  if (!a) return b
  const out: Attrs = { ...a }
  // `!== undefined`, not truthiness: an explicit `id=""` in a later block wins
  // over an earlier `#old` (last-wins §15), e.g. `[x]{#old}{id=""}` -> `id=""`.
  if (b.id !== undefined) out.id = b.id
  if (b.classes) out.classes = [...(out.classes ?? []), ...b.classes]
  if (b.keyValues) out.keyValues = { ...(out.keyValues ?? {}), ...b.keyValues }
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
    for (const key of Object.keys(b.keyValues)) {
      Object.defineProperty(values, key, { value: b.keyValues[key], writable: true, enumerable: true, configurable: true })
    }
  }
  for (const slot of attrOrder(b)) {
    if (!seen.has(slot)) {
      seen.add(slot)
      out.order!.push(slot)
    }
  }
  return out
}
