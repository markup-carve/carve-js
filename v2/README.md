# Carve 0.2

The 0.2 engine is in `v2/src`. Its public TypeScript entry point is `v2/src/index.ts`.

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
