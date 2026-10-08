# AST sidecars and conversion diagnostics

Sidecars sit beside the canonical AST JSON. They are not part of the document tree. Pass the same tree to each reader so it can check node paths and references.

```ts
const ast = toAstJson(parse(source))
const identity = toNodeIdentity(ast, 'editing-session-1')
const annotations = toAnnotationRanges(ast, ranges)
const provenance = toProvenance(ast, sources, nodeOrigins)
const authored = toAuthoredProvenance(ast, source, 'file:///doc.crv')
const parsed = parseWithProvenance(source, 'file:///doc.crv')
```

`createEditorSession(source).snapshot().identity` supplies session-scoped node IDs. An unchanged node keeps its ID when the session can match its source span after an edit. A node that cannot be matched gets a new ID. Editing a child also gives its enclosing nodes new IDs. The session never gives an old ID to a different node.

`readNodeIdentity`, `readAnnotationRanges`, and `readProvenance` reject unsupported versions, invalid paths, and broken references. `parseWithProvenance` parses Carve source and measures byte ranges for its top-level authored blocks. `toAuthoredProvenance` does the same for a parsed AST and its source. Include, import, nested, and generated provenance must come from the caller when those facts are known.

`renderCarveWithConversionReport(ast)` returns `{ value, report }`. `value` is absent if the writer refuses an unspellable structure. The report names fields or structures that Carve source cannot spell. Pass writer options as the second argument and a stored-diagnostic limit as the third. `totalDiagnostics` still counts every diagnostic.

The canonical writer emits pipe tables. It adds `header-rows` and `footer-rows` attributes to preserve a leading head, one body without intermediate headers, and a footer. These attributes also preserve an explicit single body with no head or foot. Multiple bodies and body-level row headers still receive `field-unspellable` for `rowGroups`. Section attributes receive separate diagnostics.

Column alignment, vertical alignment, and fractional widths reparse as `columns` through their source attributes. Decimal widths retain their precision through percentage conversion. The writer keeps authored attributes; when they conflict with a partition or columns, the report names the affected `rowGroups` or `columns` field. Generated source attributes are a spelling change. AST JSON exchange and HTML rendering preserve the original metadata.

The two reports never overlap. `renderCarveWithReport` answers what the selected renderer dropped, and its `code` enum holds `raw-format-dropped`, `ruby-flattened`, `editorial-comment-flattened` and `destination-denied` (PART 11 §1d) - each naming something the selected renderer dropped or blanked. A dropped field or an interchange-only structure belongs to this channel instead: table section attributes (`rowGroups.headAttrs`, `rowGroups.footAttrs`, `rowGroups.bodies[N].attrs`), `table_cell.blocks`, `math.label`, `math.number` and `section` are all reported here, and `--strict-losses` and `--allow-loss` do not see them.

See [source editing sessions](editor-sessions.md) for incremental reuse and fallback behavior.
