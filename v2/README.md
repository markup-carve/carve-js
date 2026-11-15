# Carve 0.2

The 0.2 engine is in `v2/src`. Its public TypeScript entry point is `v2/src/index.ts`.

## Formatting API

`format(source)` and `write(document)` return source when the writer can spell the result without loss. If the writer loses a field or node, or refuses a repair, these calls throw `CarveWriteError`. Its `diagnostics` property names the loss. Use `formatWithDiagnostics` or `writeWithDiagnostics` to receive the nearest source and its diagnostics. A result with `writer-refused` is not canonical. `write` and `writeWithDiagnostics` parse each written group of blocks once more and compare it with the tree; pass `{ check: false }` to skip that parse for a tree that a parse returned. `format` writes the tree of its own parse and makes no such parse.

## Command line

Run the source entry point with Node, or use the package bin `carve2`. Omit a file or use `-` for standard input. `--help` lists options for each command; `--version` prints the package version.

```sh
carve2 render --heading-ids lower article.crv
carve2 ast --envelope article.crv
carve2 fmt --check article.crv
carve2 diagnostics --json article.crv
carve2 upgrade --check legacy.crv
```

`carve2 FILE...` is shorthand for `carve2 render FILE...`. `render` and `fmt` accept `--from-ast` for AST JSON. `fmt --diff` prints a unified diff, and `fmt -w` writes files in place. `upgrade` uses the separate rewrite engine in `upgrade/`; its report may require manual review. All commands accept `--help`.
