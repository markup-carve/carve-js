# Upgrade tool against the upgrade map (spec `0d422808`)

No contract case is red after this session: `npm --prefix upgrade test` passes 2,721 tests. The five cases that were red at `080983a4` were all corrected by the specification head, and the tool follows the map:

| Case | Map row at `0d422808` | Result |
|---|---|---|
| U-105#0 | `to` closes the code span after `<b>x</b>` (C2-I-017) | the tool writes the map's `to` (U-105 escape, then the U-258 closure) |
| U-125#1 | the map row states only `> +` over `>`; UPGRADING.md says the empty code span 0.1 gave is not reached in 0.2 | input dropped from `contract.json`, as the map dropped it |
| U-144#0 | withdrawn (C2-I-104) | row dropped |
| U-190#0, #1 | the map keeps only the attribute-boundary input, rewritten with a closing run; the hard-break input needs no change (C2-I-104) | the tool writes the map's `to` |

Rows synced to the map: U-144, U-156, U-173, U-183, U-196, U-208 and U-231 dropped from `contract.json` and `data/entries.json`; U-258 and U-259 added (226 entries).

## Finding for the specification: U-183 withdrawn too broadly

The map withdraws U-183 because `![][]` above `^ a` is paragraph text in both versions (C2-I-072, C2-B-197). An unresolved image reference with a label is not:

```carve
![a][nope]
^ cap
```

0.1 gives one paragraph holding both lines; 0.2 gives a `<figure>` with the text `![a][nope]` and the caption `cap` (C2-B-147). A backslash before the `!` keeps the 0.1 HTML. Four measured real sources hit this shape (`docs/ast-json-contract.md:556`, edge cases 0209 and 0434). The tool keeps the rewrite as its own entry `X-003`; the map should restate U-183 with this input or add a row.
