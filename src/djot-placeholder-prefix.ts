export function djotPlaceholderPrefix(source: string, base: string): string {
  if (!source.includes(base)) return base + '0\0'
  const reserved = new Set<string>()
  for (const match of source.matchAll(/(\0DJOT[A-Z]+\0?)([0-9]+)/g)) {
    if (match[1] === base && source[match.index! + match[0].length] === '\0') reserved.add(match[2]!)
  }
  let serial = 0
  while (reserved.has(String(serial))) serial++
  return base + serial + '\0'
}

