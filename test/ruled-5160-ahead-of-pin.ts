/** Formatter sidecars rewritten by carve#5160 (CARVE-P11-079 (a) collects the note), ahead of the pinned submodule. */
export const RULED_FMT_AHEAD_OF_PIN_5160: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ['620-generated-container-documents-23', {
    reason: 'carve#5160 collects a list-held footnote definition; the losing duplicate note is dropped, not kept as source',
    fmt: '- a\n\n[^f]: t\n\n[r]: /url\n',
  }],
])
