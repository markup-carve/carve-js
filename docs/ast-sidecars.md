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

`renderCarveWithConversionReport(ast)` returns `{ value, report }`. `value` is absent if the writer refuses an unspellable structure. The report names fields or structures that Carve source cannot spell. `renderCarveWithReport` reports renderer loss; some nodes appear in both reports because they meet both criteria. Pass writer options as the second argument and a stored-diagnostic limit as the third. `totalDiagnostics` still counts every diagnostic.
