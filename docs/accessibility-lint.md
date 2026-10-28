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

The API reports `a11y/image-alt` and `heading-level-skip`. The authoring lint
API accepts `a11y/heading-jump` as a deprecated input alias for
`heading-level-skip` until the next minor release. Findings use the canonical
`heading-level-skip` id.

This is an authoring aid, not a WCAG-conformance claim. Decorative-image
semantics, configuration, nested traversal coverage, and additional rules are
still being developed.
