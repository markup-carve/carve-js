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
`normalized`, and adds non-HTML diagnostics. 

Markdown, Djot, and BBCode verify a narrow literal-text subset: empty input or
Unicode letters and numbers separated by single ASCII spaces, with optional
trailing line endings. When the imported text matches and no known loss was
reported, `literal-text-verified` records preserved/exact evidence. All other
inputs retain the dropped/fallback `fidelity-unverified` warning.

Markdown adds the construct-level losses it can prove beside that row. A table
row whose every cell is blank has no Carve spelling, so it is dropped and
reported as `structure-unspellable`, dropped/exact - the same code and the same
fidelity the HTML importer spends on that row. The row carries no `path` or
`line`: the Markdown importer folds and re-spells a container's lines before it
writes a row, so it has no position it could stand behind, and one drop is one
diagnostic. The `fidelity-unverified` row stays: it still stands for the
constructs the Markdown importer has no answer for.
Markdown also reports `frontmatter-synthesized`, info/normalized at `line:1`,
on every leading `---` block it carries over as Carve front matter. Confidence
follows the opener: `inferred` for a bare `---` claimed by the shape test,
`exact` for a typed one that named its format. A BARE `---` block is taken only
when its content has the SHAPE of a mapping: skipping blank lines and
`#` comment lines, the first line left has to be, at column 0, a key plus `:`
and then a space, a tab or the end of the line. A scalar block such as
CommonMark example 96's `---\nFoo\n---` is a thematic break over setext headings
instead, and is written as one. The test is a string inspection rather than a
YAML parse, so the three engines cannot drift apart on an edge case; the cost is
that malformed content such as `title: [unclosed` still counts as front matter.
Since the two readings disagree about whether a heading survives, the decision
is reported rather than left silent.

A TYPED opener - `---yaml`, `---toml`, `---json`, any `frontmatter_format` -
takes no shape test. The author has said what the block is, and PART 1's "a
break is a dash run and nothing else" means a typed opener is not a thematic
break under any reading, so the collision the test resolves cannot arise. A
typed opener keeps the prior reading, the "at least one non-blank line" check,
and `---yaml` holding a scalar is front matter whose payload is a scalar.

Markdown reports `raw-code-fallback` with warning severity, degraded fidelity
and exact confidence when an HTML code payload needs raw HTML to preserve its
content or structure in Carve source. The HTML output keeps the code payload;
targets and profiles that escape or omit raw HTML change its structure and
content. A payload that can round-trip through a native Code node does not take
this loss.

Markdown reports `raw-span-whitespace-trimmed`, warning/degraded/exact, at
`line:N` for every raw span whose content would end a content line in
whitespace. CARVE-P2-025 drops a whitespace run at the end of every content
line and a verbatim run crossing a line break is no exception, so this input:

```markdown
<a href="foo  
bar">
```

reaches the converted source with the two spaces written and reads back without
them. The loss is `degraded` rather than `dropped` because the span and its text
survive and the whitespace does not, and it is reported rather than respelled:
the shape is inline content inside a paragraph, so a raw block would keep the
bytes at the cost of a different block structure
(markup-carve/carve#2804). The `line` names the line of the INPUT the importer
was given. Whitespace a raw span carries anywhere but a line end is not
reported, because Carve keeps it.

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
