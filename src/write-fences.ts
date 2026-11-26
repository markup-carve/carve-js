/** C2-W-038: the longest bare run of `char` on a line, allowing outer spaces and tabs. */
export function longestBareRun(lines: readonly string[], char: number): number {
  let longest = 0
  for (const line of lines) {
    let start = 0
    while (start < line.length && (line.charCodeAt(start) === 32 || line.charCodeAt(start) === 9)) start++
    let end = start
    while (end < line.length && line.charCodeAt(end) === char) end++
    let rest = end
    while (rest < line.length && (line.charCodeAt(rest) === 32 || line.charCodeAt(rest) === 9)) rest++
    if (rest === line.length) longest = Math.max(longest, end - start)
  }
  return longest
}
