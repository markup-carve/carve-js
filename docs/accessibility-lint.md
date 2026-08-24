# Accessibility linting

`lintAccessibility` reports structural accessibility problems with source
offsets.

```ts
import { lintAccessibility } from '@markup-carve/carve'

const diagnostics = lintAccessibility('# One\n\n### Three\n\n![](/map.png)\n')
for (const diagnostic of diagnostics) {
  console.log(diagnostic.rule, diagnostic.startOffset, diagnostic.message)
}
```

The draft implements `a11y/image-alt` and `a11y/heading-jump`. The same API can
serve a CLI, browser editor, CI check, or LSP, avoiding separate regex-based
implementations that disagree about parsed structure.

This is an authoring aid, not a WCAG-conformance claim. Decorative-image
semantics, configuration, nested traversal coverage, and additional rules are
still being developed.
