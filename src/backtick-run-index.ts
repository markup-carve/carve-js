/** Exact maximal closers for every possible start within a backtick run. */
export function backtickRunEnds(text: string): Int32Array | undefined {
  if (!text.includes('`')) return undefined
  const ends = new Int32Array(text.length).fill(-1)
  const runs: Array<[number, number]> = []
  for (let at = text.indexOf('`'); at !== -1; at = text.indexOf('`', at)) {
    const start = at
    while (text[at] === '`') at++
    runs.push([start, at - start])
  }
  const next = new Map<number, number>()
  for (let r = runs.length - 1; r >= 0; r--) {
    const [start, width] = runs[r]!
    for (let offset = 0; offset < width; offset++) ends[start + offset] = next.get(width - offset) ?? -1
    next.set(width, start + width)
  }
  return ends
}
