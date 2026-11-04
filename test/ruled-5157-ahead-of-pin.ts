/** Formatter sidecars rewritten by carve#5157 (a refused `+` after a nested fence leaves no node), ahead of the pinned submodule. */
export const RULED_FMT_AHEAD_OF_PIN_5157: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ['626-an-indented-plus-below-a-nested-fence-stays-content-at-every-depth-8', {
    reason: 'carve#5157 writes the fence closed at its base column and no node for the refused +',
    fmt: '- - [ ] ```js\n        x\n\n    ```\n\ntail\n',
  }],
])
