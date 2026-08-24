# Shared migration results

Use `migrateHtml`, `migrateMarkdown`, or `migrateDjot` when an application needs
both converted Carve source and a stable report envelope.

```ts
import { migrateHtml } from '@markup-carve/carve'

const result = migrateHtml('<p><kbd kbd=lit>text</kbd></p>')
for (const diagnostic of result.report.diagnostics) {
  if (diagnostic.fidelity === 'dropped') console.warn(diagnostic.message)
}
await save(result.value)
```

All three functions return `{ value, report }`. Reports identify their schema
version and source format. HTML diagnostics add `fidelity` and `confidence`;
Markdown and Djot currently return explicit empty diagnostic arrays.

The value is one migration pipeline for browser tools, Node applications, and
bindings. Consumers no longer need HTML-only branching, and future source
ranges, safe fixes, and batch reporting have a compatible place to land.

The existing `htmlToCarve`, `markdownToCarve`, and `djotToCarve` convenience
functions remain available.
