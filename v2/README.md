# Carve 0.2

The 0.2 engine is in `v2/src`. Its public TypeScript entry point is `v2/src/index.ts`.

## Formatting API

`format(source)` and `write(document)` return source when the writer can spell the result without loss. If the writer loses a field or node, or refuses a repair, these calls throw `CarveWriteError`. Its `diagnostics` property names the loss. Use `formatWithDiagnostics` or `writeWithDiagnostics` to receive the nearest source and its diagnostics. A result with `writer-refused` is not canonical. `write` and `writeWithDiagnostics` parse each written group of blocks once more and compare it with the tree; pass `{ check: false }` to skip that parse for a tree that a parse returned. `format` writes the tree of its own parse and makes no such parse.

## Includes

A library parse expands include directives (`spec/0.2/includes.md`) only when the `includes` option gives a resolver. Without one, every directive stays text and the parse reports `include-no-resolver`.

```ts
import { includeDependencies, parse, render } from './src/index.ts'

const files: Record<string, string> = { 'chapter.crv': '= Chapter\n\nBody.\n' }
const resolver = ({ path }: { path: string }) =>
  Object.hasOwn(files, path) ? { text: files[path]!, id: path } : { error: 'not_found' as const }

render('{{ chapter.crv }}', { includes: resolver })
const tree = parse('{{ chapter.crv }}', { includes: { resolver, file: 'main.crv', depth: 8 } })
includeDependencies(tree) // [{ path: 'chapter.crv', file: 'chapter.crv', read: true }]
```

A resolver receives the decoded `path`, the `section`, the valid `options` and `from`, the id of the including file. It returns the whole text (a string or UTF-8 bytes) with an id, or one error: `not_found`, `outside_root`, `unreadable` or `non_text`. The object form also takes `file`, the id of the top-level document for the cycle check, and lowered `depth` (at most 16) and `bytes` (at most 8388608) limits. An expanded include keeps its node, with `file` and `children`; `fmt` and `write` write the directive, never the children. `lint(source, { includes })` lints the included files too.

## Command line

Run the source entry point with Node, or use the package bin `carve2`. Omit a file or use `-` for standard input. `--help` lists options for each command; `--version` prints the package version.

```sh
carve2 render --heading-ids lower article.crv
carve2 ast --envelope article.crv
carve2 fmt --check article.crv
carve2 diagnostics --json article.crv
carve2 upgrade --check legacy.crv
```

`render`, `ast` and `diagnostics` expand includes by default, reading files below the directory of the entry file (the containment root, with every symbolic link resolved). `--include-root DIR` names another root, and `--no-includes` turns expansion off. On standard input nothing is expanded unless `--include-root` is given. `fmt` never expands.

`carve2 FILE...` is shorthand for `carve2 render FILE...`. `render` and `fmt` accept `--from-ast` for AST JSON. `fmt --diff` prints a unified diff, and `fmt -w` writes files in place. `upgrade` uses the separate rewrite engine in `upgrade/`; its report may require manual review. All commands accept `--help`.
