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

/** One write to the id or class slot: the slot (`#id`, `.class`) or the key spelling, and its value or classes. */
type SlotWrite = readonly [slot: string, value: string | readonly string[]]

/**
 * PART 10 §1: the id slot takes the value written last and the class slot every
 * class in source order, whatever the spelling. The `Attrs` fields cannot order
 * an `ID` key against `#id`, nor keep a repeated `CLASS` key, so the writes ride
 * along under a symbol: spread copies keep it and the JSON AST does not show it.
 */
const SLOT_WRITES = Symbol('carve.slotWrites')
type LoggedAttrs = Attrs & { [SLOT_WRITES]?: readonly SlotWrite[] }

const foldsToSlot = (key: string): boolean => {
  const fold = key.toLowerCase()
  return fold === 'id' || fold === 'class'
}

/** Attach `writes` when a key spells the id or class slot, the one case the fields cannot order. */
export function recordSlotWrites(attrs: Attrs, writes: readonly SlotWrite[] | undefined): void {
  if (writes && attrs.keyValues && Object.keys(attrs.keyValues).some(foldsToSlot)) (attrs as LoggedAttrs)[SLOT_WRITES] = writes
}

function slotWritesOf(a: Attrs): readonly SlotWrite[] {
  const logged = (a as LoggedAttrs)[SLOT_WRITES]
  if (logged) return logged
  const writes: SlotWrite[] = []
  for (const slot of attrOrder(a)) {
    if (slot === '#id') { if (a.id !== undefined) writes.push(['#id', a.id]) }
    else if (slot === '.class') { if (a.classes?.length) writes.push(['.class', [...a.classes]]) }
    else if (foldsToSlot(slot) && a.keyValues?.[slot] !== undefined) writes.push([slot, a.keyValues[slot]!])
  }
  return writes
}

function carrySlotWrites(out: Attrs, a: Attrs, b: Attrs): void {
  if ((a as LoggedAttrs)[SLOT_WRITES] || (b as LoggedAttrs)[SLOT_WRITES]) {
    (out as LoggedAttrs)[SLOT_WRITES] = [...slotWritesOf(a), ...slotWritesOf(b)]
  }
}

const ownedSlotWrites = new WeakMap<Attrs, SlotWrite[]>()

/** `carrySlotWrites` for a parser-owned accumulator: appends in place. */
function appendSlotWrites(out: Attrs, b: Attrs): void {
  const owned = ownedSlotWrites.get(out)
  if (owned) {
    owned.push(...slotWritesOf(b))
    return
  }
  if (!(out as LoggedAttrs)[SLOT_WRITES] && !(b as LoggedAttrs)[SLOT_WRITES]) return
  const writes = [...slotWritesOf(out), ...slotWritesOf(b)]
  ;(out as LoggedAttrs)[SLOT_WRITES] = writes
  ownedSlotWrites.set(out, writes)
}

const keyClasses = (value: string): string[] => {
  const tokens = value.split(/[\t\n\f\r ]+/).filter((t) => t !== '')
  return tokens.length ? tokens : [value]
}

/**
 * The id and classes the recorded writes give. A slot the attrs no longer
 * match (a caller or the heading id pass edited it) is left out: `id` is an
 * own property only when the id writes still hold.
 */
export function slotsByWriteOrder(a: Attrs): { id?: string | undefined; classes?: string[] } | undefined {
  const writes = (a as LoggedAttrs)[SLOT_WRITES]
  if (!writes) return undefined
  let id: string | undefined
  let slotId: string | undefined
  const slotClasses: string[] = []
  const classes: string[] = []
  const lastKey = new Map<string, string>()
  for (const [slot, value] of writes) {
    if (slot === '.class') {
      slotClasses.push(...value)
      classes.push(...value)
    } else if (slot === '#id') {
      slotId = id = value as string
    } else {
      lastKey.set(slot, value as string)
      if (slot.toLowerCase() === 'id') id = value as string
      else classes.push(...keyClasses(value as string))
    }
  }
  const keyValues = a.keyValues ?? {}
  const keysHold = (fold: string): boolean =>
    Object.keys(keyValues).every((key) => key.toLowerCase() !== fold || lastKey.get(key) === keyValues[key]) &&
    [...lastKey].every(([key, value]) => key.toLowerCase() !== fold || keyValues[key] === value)
  const idHolds = slotId === a.id && keysHold('id')
  const classesHold = slotClasses.length === (a.classes?.length ?? 0) && slotClasses.every((c, i) => c === a.classes![i]) && keysHold('class')
  return { ...(idHolds ? { id } : {}), ...(classesHold && classes.length ? { classes } : {}) }
}

export function mergeAttrs(a: Attrs | undefined, b: Attrs): Attrs {
  if (!a) return b
  const out: Attrs = { ...a }
  carrySlotWrites(out, a, b)
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
  const written = slotsByWriteOrder(a)
  if (written && Object.hasOwn(written, 'id')) return written.id
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
  appendSlotWrites(out, b)
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
