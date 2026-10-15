/**
 * Replace every lone surrogate with U+FFFD, one code unit for one, so offsets
 * do not move (carve CARVE-P0-023). A paired surrogate is left alone. One
 * linear scan; a well-formed string is returned unchanged.
 */
export function replaceLoneSurrogates(text: string): string {
  let out: string[] | null = null
  let last = 0
  const n = text.length
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i)
    if (c < 0xd800 || c > 0xdfff) continue
    if (c <= 0xdbff && i + 1 < n) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++
        continue
      }
    }
    out ??= []
    out.push(text.slice(last, i), '�')
    last = i + 1
  }
  if (out === null) return text
  out.push(text.slice(last))
  return out.join('')
}
