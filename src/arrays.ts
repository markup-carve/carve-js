// A call spreads its arguments onto the stack, so `push(...list)` throws once a list holds about
// 125,000 items. These helpers take input-sized lists without that limit.

/** Appends `items` to `target`. */
export function pushAll<T>(target: T[], items: Iterable<T>): void {
  for (const item of items) target.push(item)
}

/** Appends `items` to `target` from last to first. */
export function pushReversed<T>(target: T[], items: readonly T[]): void {
  for (let at = items.length - 1; at >= 0; at--) target.push(items[at]!)
}

/** `list.splice(at, remove, ...items)` in linear time for any number of items. */
export function spliceAll<T>(list: T[], at: number, remove: number, items: readonly T[]): void {
  const tail = list.slice(at + remove)
  list.length = at
  pushAll(list, items)
  pushAll(list, tail)
}

/** The largest of `values`, or `floor` when none is larger. */
export function maxOf(values: Iterable<number>, floor = -Infinity): number {
  let max = floor
  for (const value of values) if (value > max) max = value
  return max
}

/** The UTF-16 code units `codes[start..end)` as a string. */
export function charsText(codes: readonly number[], start = 0, end = codes.length): string {
  let out = ''
  for (let at = start; at < end; at += 4096) out += String.fromCharCode(...codes.slice(at, Math.min(at + 4096, end)))
  return out
}
