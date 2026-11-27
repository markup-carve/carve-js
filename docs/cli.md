# Engine commands and flags

`spec/0.2/tooling.md` specifies the commands every engine offers ([engine notes](engine.md#command-line)). The `carve` program of this package adds the commands and flags below, which the 0.1 command line had. They are engine features: the specification leaves them to each engine (C2-T-003), and no other engine has to offer them.

```sh
carve flatten book.crv > book-all.crv
carve fix notes.md.crv > notes.crv
carve fix --write docs/*.crv
carve lint --fix --write --json docs/*.crv
carve upgrade --migrate --write legacy.crv
carve import --from gfm --directory docs --output docs-carve
carve render -o page.html page.crv
carve lint --strict --ignore vendor/third-party.crv book.crv
```

## `carve flatten`

`carve flatten [FILE...]` writes each file as one Carve document with every include expanded in place, through the Carve writer. `fmt` keeps an include as its directive (C2-N-005); `flatten` is the command that replaces it with the included blocks, for a host that has no file system behind it. The library call `flatten` does the same on a parsed tree ([API](api.md#includes)).

Includes resolve as in `render`: below the directory of the entry file, or below `--include-root DIR`. Standard input expands only with `--include-root`. Frontmatter of an included file is dropped, since it renders nothing.

A file fails with status 1 and the run goes on with the next file when:

- an include did not expand: its entries are written on standard error and the category is `include-unresolved`;
- the flattened document would render differently from the expanded one, with the category `flatten-changed`. Footnote, link reference and abbreviation keys are looked up per file (C2-N-054, C2-N-055), so two included files that each define `[^n]` give two notes, and one flattened file would give one;
- the writer cannot spell the tree: `writer-refused`.

## `carve fix` and `carve lint --fix`

`carve fix` is `carve lint --fix`, with the same flags. It rewrites the Markdown and Djot habits that Carve 0.2 reads as literal text, each to the replacement that the message of its lint rule names:

| Rule | Before | After |
| --- | --- | --- |
| `markdown-strong-double-star` | `**b**` | `*b*` |
| `markdown-strikethrough-double-tilde` | `~~s~~` | `{~s~}` |
| `djot-emphasis-underscore` | `_i_` | `/i/` |
| `djot-intraword-underscore` | `snake_case_name` | `snake{/case/}name` |
| `djot-subscript-tilde` | `H~2~O` | `H{,2,}O` |
| `djot-superscript-caret` | `x^2^` | `x{^2^}` |
| `deprecated-bare-strike` | `~s~` | `{~s~}` |
| `deprecated-bare-highlight` | `=h=` | `{=h=}` |
| `djot-plus-bullet` | `+ item` | `- item` |
| `heading-closing-hashes` | `# Title ##` | `# Title` |
| `thematic-break-spelling` | `---` | `***` |

Under `--fix` each rule keeps the state it has under `lint` (C2-T-049, C2-T-031). `markdown-strong-double-star`, `markdown-strikethrough-double-tilde` and `heading-closing-hashes` are on. The others are migration notices (C2-W-156): they rewrite only a document that declares a Carve version below 0.2, under `--upgrade`, or when `--rules` turns them on, and `--rules` turning one off keeps it off over both. So `carve fix` leaves `a =x= b` in a 0.2 document as written, and `carve fix --upgrade` writes `a {=x=} b`. A rule whose message offers two replacements, such as `deprecated-bare-underline` (braced underline or the slash pair), has no fix.

A fix is applied only when it holds:

- Where two rules report one range with different replacements, the range is left as written. `~t~` is Djot subscript and also the 0.1 strike, so `carve fix --upgrade --rules '{"djot-subscript-tilde":"off"}'` picks the strike and `'{"deprecated-bare-strike":"off"}'` the subscript.
- The fixed source is parsed once, and a fix whose node does not stand where the finding started is dropped. A `+ item` line directly below paragraph text becomes no list item with `-` either, so it stays.
- Fixes repeat until a pass changes nothing, so a habit nested in another is fixed too.

Without `--write`, the fixed source goes to standard output, and `FILE: fixed RULE COUNT, ...` and the entries that remain go to standard error. With `--write` (`-w`), each changed file is replaced and the remaining entries are the product, as lines or with `--json` as a report. The status is that of `lint` on the fixed source. `--write` without `--fix`, and `--json` without `--write`, are refused with `usage`.

## `carve upgrade --migrate`

`--migrate` is the `fmt --migrate` of 0.1. Before the upgrade reads a 0.1 file, a cross-reference `</#id>` or a reference label that misses its target only by case is respelled to that target, when exactly one target matches it. Each respelled line gets a `case-reference` record of class `rewrite`. A reference with several candidates is left for `lint`.

## `carve import --directory`

`carve import --from gfm --directory SOURCE --output TARGET` converts a tree of Markdown files, as `migrate --from markdown --directory` did in 0.1. `--from markdown` reads strict CommonMark instead. Each file is imported as `importDocument` imports it:

- A `.md` or `.markdown` file (the extension in any ASCII case) becomes a `.crv` file at the same path. Another regular file is copied with its permission bits. A symlink or special file is skipped and listed in the report.
- A local link or image to a converted file is rewritten to its `.crv` name once its target and fragment are found in the output. A fragment that matches one heading id only without regard to case is respelled to that id, with a `link-fragment-case-rewritten` hint. A missing file or fragment, a site-root path, a path outside `SOURCE` and a fragment into a copied file are left as written and reported. A URL in raw HTML is checked but never rewritten.
- `TARGET/migration-report.json` holds `schemaVersion`, `sourceFormat`, and `files`: each with its `source`, `output`, its import `diagnostics` and its `links`, each link `rewritten`, `valid` or `unresolved` with a `reason`. It also holds `assets`, `skipped`, and `review`, the files with an unresolved link or a loss.

`TARGET` must not exist and must lie outside `SOURCE`. Two inputs that map to one output, such as `a.md` and `a.markdown`, are refused. The tree is built beside `TARGET` and moved into place at the end, so a refused run leaves no output; these refusals have the category `usage`, and a file that cannot be read has `input-unreadable`. The summary line goes to standard output. The status is 0, or 1 under `--strict-losses` when a file needs review or an entry was skipped. `--directory` takes no file and refuses `--raw-html`, `--adapter`, `--list-table` and the loss report flags.

## Flags on the specified commands

- `-o FILE`, `--output FILE` on `render`, `fmt` and `import`: the product of the run goes to `FILE` instead of standard output. What the files before a failure of status 2 produced is written too. `fmt` refuses it with `--write`, `--check` or `--diff`, and every command refuses it when a report names the same path.
- `--strict` on `render` and `lint`: a file that wrote any entry ends with status 1, a hint included. `render --strict` still writes the HTML; `--strict-losses` is the flag that withholds it.
- `--upgrade` on `lint`: turns on the migration notices, the rules that report 0.2 text which 0.1 read differently. A document whose line-1 frontmatter declares `carve: 0.1` gets them without the flag (C2-W-156).
- `--ignore FILE-ID` on `lint`, repeatable: the entries of that file are dropped. An included file is named by its id, its path from the include root; the entry file by its name as given.

## Migrating from the 0.1 command line

The `carve` program of 0.1.x took the commands and flags below, which 0.2 removes or renames. The specification's map of the 0.1 flags is in the command line section of `spec/0.2/UPGRADING.md`; this table lists every flag of this package's 0.1 program that 0.2 drops.

| 0.1 | 0.2 |
| --- | --- |
| `render --html` | `carve render`, or `render --to html`; HTML is the default |
| `render --markdown`, `--md` | `carve render --to markdown` |
| `render --plain`, `--plain-text` | `carve render --to plain` |
| `render --ansi`, and `carve --ansi FILE` | `carve render --to ansi` |
| `render --carve` | `carve fmt`; `carve fmt --from-ast` writes a 2.0 tree as source |
| `render --json`, `render --ast` | `carve ast` |
| `render --from-json` | `--from-ast` on `render` and `fmt`; migrate an older tree first with `carve migrate-ast` |
| `render --no-raw-html`, `render --safe` | the default; `--raw-html` turns raw HTML on |
| `render --profile-base-host HOST` | no flag; a library host registers `linkPolicy({ baseHost })` from `@markup-carve/carve/extensions` ([navigation](extensions-navigation.md)) |
| `render --stamp-info`, `render --stamp-check` | none; 0.2 source carries no stamp. The `carve` key of line-1 frontmatter declares the version, and `carve upgrade --check FILE` exits with 1 when the upgrade would change the file |
| `fmt --stamp`, `fmt --stamp-block` | none; no stamp is written |
| `fmt --stdout`, `fix --stdout` | the default: without `--write`, `fmt` and `fix` write the result to standard output |
| `fmt --migrate` | `carve upgrade --migrate`, described above |
| `fix --check` | no flag; `carve lint` reports the findings that `fix` rewrites, and `carve fix FILE \| cmp -s - FILE` tells whether a fix would change the file |
| `lint --rule ID`, `lint --platform NAME` | `carve lint --rules '{"ID":"on"}'`, `--platforms '["NAME"]'` |
| `lint --from-djot` | turn the `djot-` rules on by id in `--rules`; `--upgrade` does not turn them on |
| `lint --caption-hints` | none needed: `caption-looking-paragraph` is on by default |
| `lint --extension citations` | `--extensions '["carve.cite"]'` registers the citations extension |
| `lint --portable` | none; it did nothing in 0.1.x either |
| `migrate --from html\|markdown\|djot\|bbcode` | `carve import --from html\|gfm\|djot\|bbcode`; `--from markdown` reads strict CommonMark |
| `migrate --adapter`, `--list-table`, `--output`, `--directory` | the same flags on `carve import` |
| `migrate --check-loss`, `migrate --report FILE` | `carve import --strict-losses`, `--report-losses FILE` |
| `migrate --mode roundtrip` | `carve import --raw-html` keeps comments and raw elements |
| `merge`, `portability`, `trace` | none; three-way merge, Djot portability checks and the decision trace are not part of 0.2 |
| `-h`, `-V` | `--help`, `--version` |
