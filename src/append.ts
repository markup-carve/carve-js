/** Appends `items` to `target` one at a time: a spread puts every item on the call stack and fails on a wide document. */
export function append<T>(target: T[], items: readonly T[]): void {
  for (const item of items) target.push(item)
}
