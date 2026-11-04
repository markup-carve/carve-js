/** Current spec corpus results for carve#5012, ahead of the pinned submodule. */
export const RULED_HTML_AHEAD_OF_PIN_5012: ReadonlyMap<string, { reason: string; html: string }> = new Map([
])

/** Formatter sidecars ahead of the pinned submodule. */
export const RULED_FMT_AHEAD_OF_PIN_5012: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ["436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-2", { reason: 'carve#5012 keeps formatter readback after invisible-line erasure', fmt: ":: t\n:  +\n\nflush\n" }],
  ["436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-4", { reason: 'carve#5012 keeps formatter readback after invisible-line erasure', fmt: ":: t\n:  +\n\nflush\n" }],
])
