/** Current carve#5013 outputs ahead of the pinned spec submodule. */
export const RULED_5013_HTML: ReadonlyMap<string, { reason: string; html: string }> = new Map([
])
export const RULED_5013_FMT: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  [
    "436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-2",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "fmt": ":: t\n: {empty}\n\nflush\n"
    }
  ],
  [
    "436-a-refused-description-plus-folds-a-line-below-column-0-and-a-comment-does-not-4",
    {
      "reason": "carve#5013 forward-only continuation marker",
      "fmt": ":: t\n: {empty}\n\nflush\n"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach",
    {
      "reason": "carve#5145 writes the item a refused plus empties as {empty} (CARVE-P11-040)",
      "fmt": "- - {empty}\n\n  > q\n"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-2",
    {
      "reason": "carve#5145 writes the item a refused plus empties as {empty} (CARVE-P11-040)",
      "fmt": "- - {empty}\n\n  ```\n  x\n  ```\n"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-3",
    {
      "reason": "carve#5145 writes the item a refused plus empties as {empty} (CARVE-P11-040)",
      "fmt": "- - {empty}\n\n  # H\n"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-4",
    {
      "reason": "carve#5145 writes the item a refused plus empties as {empty} (CARVE-P11-040)",
      "fmt": "- - {empty}\n\n  {.c}\n  > q\n"
    }
  ],
  [
    "929-a-refused-plus-is-escaped-when-the-block-below-would-attach-5",
    {
      "reason": "carve#5145 writes the item a refused plus empties as {empty} (CARVE-P11-040)",
      "fmt": "- foo\n  1. {empty}\n   > b\n"
    }
  ],
])
