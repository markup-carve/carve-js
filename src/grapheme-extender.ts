// A delimiter followed by one of these is part of a larger character, such as
// the keycap `*` U+FE0F U+20E3, and neither opens nor closes (CARVE-P3-025).
// Mc counts too: extended grapheme clusters include spacing marks.
const GRAPHEME_EXTENDER = /[\p{Mn}\p{Mc}\p{Me}\u{FE00}-\u{FE0F}\u{200D}]/uy

export function extendsGrapheme(text: string, at: number): boolean {
  if (!(text.charCodeAt(at) >= 0x300)) return false
  GRAPHEME_EXTENDER.lastIndex = at
  return GRAPHEME_EXTENDER.test(text)
}
