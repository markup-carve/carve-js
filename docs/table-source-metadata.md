# Table source metadata

Pipe tables use `header-rows` and `footer-rows` for their leading and trailing
sections. `body-rows` gives the data-row count of each body, in order.
`body-header-rows` gives each body's intermediate header count, and
`body-header-cols` gives each body's leading row-header-column count.

```carve
{header-rows=1 body-rows=1,1 body-header-rows=1,0 body-header-cols=1,0 footer-rows=1}
| Name | Value |
| Group | Unit |
| Alpha | 1 |
| Beta | 2 |
| Total | 3 |
```

Both body header lists require `body-rows` and must match its length. Omitted
header-row counts default to zero only when the key is absent. Empty header-row
entries are invalid; empty header-column entries each occupy one position.
For zero bodies, omit both body header lists. Empty header-column entries leave the AST
field unset; `0` explicitly sets it to zero. `body-rows=""` states no bodies,
while `body-rows=0` states one empty body. All row counts must partition every
row exactly once. Invalid body metadata creates no explicit partition and all
row-group attributes remain ordinary HTML attributes.

Canonical export adds missing metadata attributes. It retains authored values
and diagnoses conflicts as `field-unspellable` for `rowGroups`. Table section
attributes and block cell content still have separate source limitations.

An authored separator row records its dash counts in `table.separatorWidths`.
For example, `|:-----|---:|` records `[5, 3]`; alignment remains on the header
cells. The array must contain at least one positive integer. Its entry count
controls the separator cell count, including ragged rows.

AST envelopes use contract version `1.1`, independently of package releases.
Readers accept supported older contracts and refuse higher minor versions.
Canonical output reproduces the recorded separator. Widths that would promote
non-header cells, or exceed native string capacity, produce a typed source
refusal.

HTML round-trip export uses `data-carve-col-widths` for decimal widths from
1 through 1000. Invalid carriers are dropped with a diagnostic. Larger AST
widths remain valid and are omitted from this HTML carrier.
