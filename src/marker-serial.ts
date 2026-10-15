/**
 * The smallest serial `s` such that no `${prefix}${s}Z` occurs in `text`, for
 * any of `prefixes`. One scan per prefix: probing serial by serial with
 * `includes` is quadratic when the input spells many consecutive serials.
 */
export function freeMarkerSerial(text: string | readonly string[], ...prefixes: string[]): number {
  const taken = new Set<string>()
  const chunks = typeof text === 'string' ? [text] : text
  for (const prefix of prefixes) {
    for (const chunk of chunks) {
      let at = chunk.indexOf(prefix)
      while (at !== -1) {
        let end = at + prefix.length
        while (end < chunk.length && chunk.charCodeAt(end) >= 0x30 && chunk.charCodeAt(end) <= 0x39) end++
        if (end > at + prefix.length && chunk[end] === 'Z') taken.add(chunk.slice(at + prefix.length, end))
        at = chunk.indexOf(prefix, at + prefix.length)
      }
    }
  }
  let serial = 0
  while (taken.has(String(serial))) serial++
  return serial
}
