# Source-preserving patches

Use a source patch when a tool should change a document without rewriting
unrelated bytes.

```ts
import { applySourcePatch, carveToCarvePatch } from '@markup-carve/carve'

const patch = carveToCarvePatch(source)
const formatted = applySourcePatch(source, patch)
```

Ranges are half-open UTF-8 byte offsets. Patches carry the original byte length and a
stable `fnv1a64:` fingerprint, so applying one to stale source throws. Edits
are sorted and non-overlapping; bytes outside them are copied exactly.

`createSourcePatch(source, replacement, kind, code)` creates the smallest
single replacement for arbitrary transformations. `unresolved` is reserved
for changes requiring writer judgment and is never applied automatically.

The [shared wire contract](https://markup-carve.github.io/carve/source-patches)
includes its authoritative JSON Schema.
