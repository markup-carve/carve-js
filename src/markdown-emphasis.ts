interface Run {
  start: number
  end: number
  char: string
  open: boolean
  close: boolean
  left: number
  right: number
  active: boolean
  previous: number
  next: number
}
interface Pair { open: number; close: number; width: number; kind: '*' | '/' }

/** Pair CommonMark delimiter runs before applying Carve's nesting ceiling. */
export function markdownEmphasis(source: string, onFlatten: () => void = () => {}, onStep?: () => void, protectedSpans: readonly string[] = []): string {
  const runs: Run[] = []
  const pairs = new Map<number, Pair>()
  const claimed = new Set<number>()
  const literalEscapes = new Set<number>()
  const neighbor = (index: number, left: boolean): string => {
    if (source[index] === '\x00') {
      const other = left ? source.lastIndexOf('\x00', index - 1) : source.indexOf('\x00', index + 1)
      const token = other < 0 ? '' : source.slice(Math.min(index, other), Math.max(index, other) + 1)
      const match = /^\x00P(\d+)\x00$/.exec(token)
      const value = match ? protectedSpans[Number(match[1])] : undefined
      if (value !== undefined) return left ? Array.from(value.slice(-2)).at(-1) ?? '' : Array.from(value.slice(0, 2))[0] ?? ''
    }
    return left ? Array.from(source.slice(Math.max(0, index - 1), index + 1)).at(-1) ?? '' : Array.from(source.slice(index, index + 2))[0] ?? ''
  }
  const punctuation = (s: string): boolean => /[\p{P}\p{S}]/u.test(s)
  const whitespace = (s: string): boolean => s === '' || /\s/u.test(s)
  for (const m of source.matchAll(/\*+|_+/g)) {
    const start = m.index
    const end = start + m[0].length
    if (source[start - 1] === '\\') continue
    const before = neighbor(start - 1, true)
    const after = neighbor(end, false)
    const left = !whitespace(after) && (!punctuation(after) || whitespace(before) || punctuation(before))
    const right = !whitespace(before) && (!punctuation(before) || whitespace(after) || punctuation(after))
    runs.push({ start, end, char: m[0][0]!, open: left && (m[0][0] === '*' || !right || punctuation(before)),
      close: right && (m[0][0] === '*' || !left || punctuation(after)), left: 0, right: 0, active: true, previous: runs.length - 1, next: runs.length + 1 })
  }
  const remaining = (r: Run): number => r.end - r.start - r.left - r.right
  const unlink = (index: number): void => {
    onStep?.()
    const run = runs[index]!
    if (run.previous >= 0) runs[run.previous]!.next = run.next
    if (run.next < runs.length) runs[run.next]!.previous = run.previous
    run.active = false
  }
  const bottoms = new Map<string, number>()
  for (let c = 0; c < runs.length; c++) {
    const closer = runs[c]!
    if (!closer.active || !closer.close) continue
    while (remaining(closer) > 0) {
      const key = `${closer.char}:${closer.open}:${remaining(closer) % 3}`
      const bottom = bottoms.get(key) ?? -1
      let o = closer.previous
      for (; o > bottom; o = runs[o]!.previous) {
        onStep?.()
        const opener = runs[o]!
        if (!opener.active || !opener.open || opener.char !== closer.char || remaining(opener) === 0) continue
        const a = remaining(opener), b = remaining(closer)
        if ((opener.close || closer.open) && (a + b) % 3 === 0 && (a % 3 !== 0 || b % 3 !== 0)) continue
        break
      }
      if (o <= bottom) {
        bottoms.set(key, c - 1)
        break
      }
      const opener = runs[o]!
      const width = Math.min(remaining(opener), remaining(closer)) >= 2 ? 2 : 1
      const open = opener.end - opener.right - width
      const close = closer.start + closer.left
      pairs.set(open, { open, close, width, kind: width === 2 ? '*' : '/' })
      for (let k = 0; k < width; k++) { claimed.add(open + k); claimed.add(close + k) }
      opener.right += width
      closer.left += width
      let j = opener.next
      while (j !== c) {
        const next = runs[j]!.next
        unlink(j)
        j = next
      }
      if (remaining(opener) === 0) unlink(o)
      if (remaining(closer) === 0) unlink(c)
    }
  }
  for (const run of runs) {
    const before = source[run.start - 1] ?? '', after = source[run.end] ?? ''
    const partiallyClaimed = claimed.has(run.start) || claimed.has(run.end - 1)
    if (partiallyClaimed || (run.char === '_' && /[^\x00-\x7f]/u.test(before + after)) || /\u00a0/u.test(before + after)) {
      for (let i = run.start; i < run.end; i++) if (!claimed.has(i)) literalEscapes.add(i)
    }
  }
  interface Frame { i: number; end: number; kind: string; pair?: Pair; parent: string; slot: number; first: string; last: string; strong: boolean }
  let flattened = false
  const output: string[] = []
  const stack: Frame[] = []
  let frame: Frame = { i: 0, end: source.length, kind: '', parent: '', slot: -1, first: '', last: '', strong: false }
  const record = (first: string, last: string): void => {
    if (frame.first === '') frame.first = first
    if (last !== '') frame.last = last
  }
  while (true) {
    if (frame.i < frame.end) {
      const pair = pairs.get(frame.i)
      if (pair && pair.close < frame.end) {
        frame.i = pair.close + pair.width
        stack.push(frame)
        frame = { i: pair.open + pair.width, end: pair.close, kind: pair.kind, pair, parent: frame.kind,
          slot: output.length, first: '', last: '', strong: false }
        output.push('')
      } else {
        const ch = source[frame.i++]!
        output.push(literalEscapes.has(frame.i - 1) ? `\\${ch}` : ch)
        record(ch, ch)
      }
      continue
    }
    if (!frame.pair) break
    const { pair } = frame
    let first = frame.first, last = frame.last
    let strong = frame.strong
    if (frame.parent !== frame.kind) {
      const intraword = /[\p{L}\p{N}]/u.test(neighbor(pair.open - 1, true)) || /[\p{L}\p{N}]/u.test(neighbor(pair.close + pair.width, false))
      const besideLiteral = [pair.open - 1, pair.close + pair.width].some(i => /[*_]/.test(source[i] ?? '') && !claimed.has(i))
      const braced = intraword || besideLiteral || (pair.kind === '/' && (first === '*' || last === '*' || (frame.parent === '*' && strong)))
      strong ||= pair.kind === '*'
      output[frame.slot] = braced ? `{${pair.kind}` : pair.kind
      output.push(braced ? `${pair.kind}}` : pair.kind)
      first = braced ? '{' : pair.kind
      last = braced ? '}' : pair.kind
    } else flattened = true
    frame = stack.pop()!
    frame.strong ||= strong
    record(first, last)
  }
  if (flattened) onFlatten()
  return output.join('')
}
