# Reversible AST patches

`createReversibleAstPatch` packages forward and inverse operations with
preconditions.

```ts
import {
  applyReversibleAstPatch,
  carveToAstJson,
  createReversibleAstPatch,
} from '@markup-carve/carve'

const before = carveToAstJson('Before.\n')
const after = carveToAstJson('After.\n')
const patch = createReversibleAstPatch(before, after)
const accepted = applyReversibleAstPatch(before, patch)
const restored = applyReversibleAstPatch(accepted, patch, true)
```

The precondition prevents replay against stale content. Carrying the inverse
enables deterministic accept, reject, and undo operations for review tools.
This is the bridge from the existing AST patch API toward ProseMirror
transactions and collaborative editorial workflows.

The Rust and JavaScript drafts still need one shared fingerprint spelling and a
versioned wire representation before interchange is promised.
