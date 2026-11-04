/** Formatter sidecars rewritten by carve#5109 (CARVE-P11-079 (a) collects the note), ahead of the pinned submodule. */
export const RULED_FMT_AHEAD_OF_PIN_5109: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ['228-a-line-at-a-footnote-definition-s-own-column-followed-by-non-blank-text-forms-its-own-tight-block', {
    reason: 'carve#5109 collects a list-held footnote definition with a lazy line to the end of the document',
    fmt: '- a\n\nsee[^f]\n\n[^f]: x\n  more\n',
  }],
])
