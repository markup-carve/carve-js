const BIDI_OVERRIDE_OR_ISOLATE = /[\u202a-\u202e\u2066-\u2069]/gu

export function isBidiControl(codePoint: number): boolean {
  return (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069)
}

/** Remove Trojan-Source override/isolate controls from presentation output. */
export function stripBidiControls(value: string): string {
  return value.replace(BIDI_OVERRIDE_OR_ISOLATE, '')
}
