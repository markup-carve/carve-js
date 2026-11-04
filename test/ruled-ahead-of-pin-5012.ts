/** Current spec corpus results for carve#5012, ahead of the pinned submodule. */
export const RULED_HTML_AHEAD_OF_PIN_5012: ReadonlyMap<string, { reason: string; html: string }> = new Map([
])

/** The two formatter sidecars replaced by carve#5012. */
export const RULED_FMT_AHEAD_OF_PIN_5012: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ["411-a-lone-indented-image-is-a-paragraph-and-its-html-cannot-say-so-2", { reason: 'carve#5012 keeps formatter readback after invisible-line erasure', fmt: " ![Apollo][moon]\n\n[moon]: a.jpg\n" }],
  ["436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-2", { reason: 'carve#5012 keeps formatter readback after invisible-line erasure', fmt: ":: t\n:  +\n\nflush\n" }],
  ["436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-4", { reason: 'carve#5012 keeps formatter readback after invisible-line erasure', fmt: ":: t\n:  +\n\nflush\n" }],
  ["191-a-blank-after-a-comment-still-ends-the-item", { reason: 'carve#5012 keeps the authored transparent line within its item', fmt: "- - a\n %% c\n\nb\n" }],
  ["430-below-a-definition-body-s-column-an-invisible-line-folds-as-text-5", { reason: 'carve#5012 keeps the authored transparent line within its description', fmt: ":: t\n: d\n  %% c\n" }],
  ["498-a-comment-line-s-text-is-content-and-a-block-body-is-payload-3", { reason: 'carve#5012 preserves the comment marker and its non-space content', fmt: "%%\u00a0x\n\ntext\n" }],
  ["498-a-comment-line-s-text-is-content-and-a-block-body-is-payload-5", { reason: 'carve#5012 preserves the comment marker and its non-space content', fmt: "%%\u000b\n\ntext\u000b\n" }],
])
