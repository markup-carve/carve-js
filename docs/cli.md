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

Under `--fix` these rules are on unless `--rules` turns one off; without `--fix` the `djot-` rules stay off by default (C2-T-031). A rule whose message offers two replacements, such as `deprecated-bare-underline` (braced underline or the slash pair), has no fix.

A fix is applied only when it holds:

- Where two rules report one range with different replacements, the range is left as written. `~t~` is Djot subscript and also the 0.1 strike, so `carve fix --rules '{"djot-subscript-tilde":"off"}'` picks the strike and `'{"deprecated-bare-strike":"off"}'` the subscript.
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

`TARGET` must not exist and must lie outside `SOURCE`. Two inputs that map to one output, such as `a.md` and `a.markdown`, are refused. The tree is built beside `TARGET` and moved into place at the end, so a refused run leaves no output; these refusals have the category `usage`, and a file that cannot be read has `input-unreadable`. The summary line goes to standard output. The status is 0, or 1 under `--strict-losses` when a file needs review or an entry was skipped. `--directory` takes no file and refuses `--raw-html`, `--adapter` and the loss report flags.

## Flags on the specified commands

- `-o FILE`, `--output FILE` on `render`, `fmt` and `import`: the product of the run goes to `FILE` instead of standard output. What the files before a failure of status 2 produced is written too. `fmt` refuses it with `--write`, `--check` or `--diff`, and every command refuses it when a report names the same path.
- `--strict` on `render` and `lint`: a file that wrote any entry ends with status 1, a hint included. `render --strict` still writes the HTML; `--strict-losses` is the flag that withholds it.
- `--upgrade` on `lint`: turns on the migration notices, the rules that report 0.2 text which 0.1 read differently. A document whose line-1 frontmatter declares `carve: 0.1` gets them without the flag (C2-W-156).
- `--ignore FILE-ID` on `lint`, repeatable: the entries of that file are dropped. An included file is named by its id, its path from the include root; the entry file by its name as given.
