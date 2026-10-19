export function encodeMarkdownDestinationCharacter(char: string): string {
  const point = char.codePointAt(0)!
  if (point > 0x7e && !/[\p{White_Space}\p{Cc}]/u.test(char) && !(point >= 0xd800 && point <= 0xdfff)) return char
  return encodeURIComponent(point >= 0xd800 && point <= 0xdfff ? '\ufffd' : char)
}

export function encodeMarkdownFragment(fragment: string): string {
  return Array.from(fragment, encodeMarkdownDestinationCharacter).join('')
}
