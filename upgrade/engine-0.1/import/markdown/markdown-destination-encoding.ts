export function encodeMarkdownDestinationCharacter(char: string): string {
  const point = char.codePointAt(0)!
  if (point > 0x7e && !/[\p{White_Space}\p{Cc}]/u.test(char) && !(point >= 0xd800 && point <= 0xdfff)) return char
  return encodeURIComponent(point >= 0xd800 && point <= 0xdfff ? '\ufffd' : char)
}

export function encodeMarkdownFragment(fragment: string): string {
  return Array.from(fragment, encodeMarkdownDestinationCharacter).join('')
}

export function escapeDestinationStructure(value: string): string {
  const openers: number[] = []
  const unpaired = new Set<number>()
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') openers.push(i)
    else if (value[i] === ')') {
      if (openers.length) openers.pop()
      else unpaired.add(i)
    }
  }
  for (const i of openers) unpaired.add(i)
  let written = ''
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    const next = value[i + char.length]
    if (char === '\\') written += next === undefined || next === '\\' || next === '(' || next === ')' ? '\\\\' : '\\'
    else if (unpaired.has(i)) written += `\\${char}`
    else written += char
  }
  return written
}

export function writeMarkdownDestinationValue(value: string, inTable = false): string {
  return Array.from(escapeDestinationStructure(value), char => inTable && char === '|'
    ? '%7C' : /[\p{White_Space}\p{Cc}]/u.test(char) ? encodeMarkdownDestinationCharacter(char) : char).join('')
}
