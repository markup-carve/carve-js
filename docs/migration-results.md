# Shared migration results

Use `migrateHtml`, `migrateMarkdown`, `migrateDjot`, or `migrateBbcode` when an application needs
both converted Carve source and a stable report envelope.

```ts
import { migrateHtml } from '@markup-carve/carve'

const result = migrateHtml('<p><kbd kbd=lit>text</kbd></p>')
for (const diagnostic of result.report.diagnostics) {
  if (diagnostic.fidelity === 'dropped') console.warn(diagnostic.message)
}
await save(result.value)
```

All four functions return `{ value, report }`. Version 2 reports identify their
source format and use the same `preserved`, `normalized`, `degraded`, or
`dropped` fidelity vocabulary plus an `exact`, `inferred`, or `fallback`
confidence. Format-specific codes and messages remain explicit.

Version 2 renames version 1's `carried` fidelity to `preserved`, adds
`normalized`, and adds non-HTML diagnostics. Markdown, Djot, and BBCode emit
`fidelity-unverified` as dropped/fallback on
every import until those paths expose construct-level loss information. The
report does not infer exact outcomes by rescanning source independently of the
importer.

Markdown adds the construct-level losses it can prove beside that row. A table
row whose every cell is blank has no Carve spelling, so it is dropped and
reported as `structure-unspellable`, dropped/exact - the same code and the same
fidelity the HTML importer spends on that row. The row carries no `path` or
`line`: the Markdown importer folds and re-spells a container's lines before it
writes a row, so it has no position it could stand behind, and one drop is one
diagnostic. The `fidelity-unverified` row stays: it still stands for the
constructs the Markdown importer has no answer for.
`Normalized` remains reserved for a future importer that can prove a
semantics-preserving rewrite from its own applied-operation record.

The value is one migration pipeline for browser tools, Node applications, and
bindings. Consumers no longer need HTML-only branching, and future source
ranges, safe fixes, and batch reporting have a compatible place to land.

The existing `htmlToCarve`, `markdownToCarve`, and `djotToCarve` convenience
functions remain available.

The CLI exposes the same contract through `carve migrate --report FILE` (use
`-` for stderr). `--check-loss` exits 1 when the report contains degraded or
dropped content, so currently unverified Markdown, Djot, and BBCode imports fail
closed. Opaque raw HTML is `degraded` even when its bytes are preserved because
the importer cannot model or edit it. `--mode` and `--adapter` remain HTML-only.
