# Migration and linting

Tools for moving Markdown or Djot documents to Carve, and for catching
constructs that would silently mis-render under Carve's rules.

## Migrating from Markdown

`markdownToCarve(md)` rewrites common Markdown into equivalent Carve. It is a
source-to-source transform, not a parser, so it works on raw text and leaves
fenced/inline code untouched.

```ts
import { markdownToCarve } from '@markup-carve/carve'

markdownToCarve('a *very* **bold** ~~old~~ idea')
// => 'a /very/ *bold* ~old~ idea'
```

It handles the inline constructs that differ between Markdown and Carve, plus
Carve's blank-line-around-blocks rule:

| Markdown                     | Carve      | Note                                                       |
| ---------------------------- | ---------- | ---------------------------------------------------------- |
| `*x*`, `_x_`                 | `/x/`      | `_x_` is **underline** in Carve, not emphasis              |
| `**x**`, `__x__`             | `*x*`      | Carve strong is a single `*`                               |
| `***x***`, `___x___`         | `/*x*/`    | Carve's canonical bold-italic                              |
| `~~x~~`                      | `~x~`      | Carve strikethrough is a single `~`                        |
| `==x==`                      | `==x==`    | literal by default - not CommonMark or GFM (`dialect.highlight` converts it to `=x=`) |
| `^x^`                        | `^x^`      | literal by default - not CommonMark or GFM (`dialect.superscript` converts it to `{^x^}`) |
| `<mark>x</mark>`             | `=x=`      | highlight tag → bare marker (brace-forced `{=x=}` intraword) |
| `<sub>x</sub>`               | `,x,`      | subscript tag → bare marker (`H<sub>2</sub>O` → `H{,2,}O` intraword) |
| `<sup>x</sup>`               | `^x^`      | superscript tag → bare marker (brace-forced `{^x^}` intraword) |
| `$x$`                        | `$x$`      | literal by default - not CommonMark or GFM (`dialect.math` converts it to `` $`x` ``, leaving `$5` as currency) |
| `<em>`/`<strong>`/`<del>`/…  | Carve form | other inline HTML tags map to their Carve markers          |

The default dialect is **CommonMark plus GFM, plus footnote references**, so a
source construct none of those defines stays as written rather than becoming
Carve markup. Seven flavour extensions are opt-in through the second argument:

```ts
markdownToCarve('a ==hi== ^up^ $x$', { highlight: true, superscript: true, math: true })
// => 'a =hi= {^up^} $`x`'
```

| Source                | Flavour            | Flag              | Off (the default)         | On                    |
| --------------------- | ------------------ | ----------------- | ------------------------- | --------------------- |
| `==x==`               | Obsidian, Quarto   | `highlight`       | literal                   | `=x=`                 |
| `^x^`                 | Pandoc             | `superscript`     | literal                   | `{^x^}`               |
| `$x$`                 | Pandoc, GitHub     | `math`            | literal                   | `` $`x` ``            |
| `^[body]`             | Pandoc             | `inlineFootnotes` | `\^[body]`                | an inline footnote    |
| `*[HTML]: HyperText`  | PHP Markdown Extra | `abbreviations`   | `\*[HTML]: HyperText`     | an abbreviation       |
| `::: note`            | Pandoc, Quarto     | `fencedDivs`      | `\::: note`               | a div                 |
| `[t]{.c}`, `{.c}`     | Pandoc, kramdown   | `attributes`      | `[t]\{.c}`, `\{.c}`       | attributes            |

`attributes` covers an attribute list wherever it would attach, not just the
bare span: `[t](u){.c}`, `![alt](u){.c}`, `` `x`{.c} ``, `<https://e.com/>{.c}`
and the emphasis family are all escaped with it off. A braced delimiter pair is
not an attribute list and is never escaped as one - `{,x,}` is a subscript in
Carve wherever it stands, and it is what `<sub>x</sub>` converts to.

The last four differ from the first three in how they got here: Carve spells
them the way the source does, so nothing had to be rewritten for a CommonMark
document to grow markup its author never saw. Escaping is what keeps them
literal, which is why the "off" column shows a backslash.

A handful of Carve constructs have no Markdown spelling in any flavour and are
always escaped, with no flag: `` a $`x` `` and `` a $$`x` `` (math spans),
`` a !`x` `` (a literal span), `a :term[x]` (an extension call), and a leading
`^ ` on a paragraph (a caption, which binds to the block above it).

**One exception to the contract: `[^1]` footnote references convert by
default.** They are in neither CommonMark nor GFM, so the rule above would put
them behind a flag. The rule exists to stop a migrated document from rendering
differently than its author saw it, and here it would cause exactly that:
github.com renders footnotes, so an author who wrote one saw one, and leaving
it literal would take it away. Where the letter of the contract and the reason
for it disagree, the reason governs. `[^1]` with its `[^1]: …` definition
therefore migrates to a Carve footnote, and this is the only construct the
contract makes room for.

The HTML tags below are unaffected: `<mark>`, `<sub>` and `<sup>` mean one
thing in every dialect, so they always convert.

On the command line the same transform is `carve migrate --from markdown`
(`--from md` works too), which reads a named file or stdin and writes Carve to
stdout. The dialect flags have no CLI spelling yet, so the command is
CommonMark plus GFM only.

```sh
carve migrate --from markdown README.md > README.crv
cat post.txt | carve migrate --from bbcode
```

> [!NOTE]
> Carve's highlight and subscript markers are **single** characters (`=x=`,
> `,x,`); the doubled forms `==x==` and `,,x,,` are literal text in Carve (see
> the corpus pair `74-two-char-delimiter-runs`). A bare `,x,` / `^x^` / `=x=`
> only renders at a word boundary, so the `<mark>`/`<sub>`/`<sup>` tags map to
> the **bare markers** when they sit between non-alphanumeric neighbors (the
> common, whitespace-separated case) and to the **forced brace forms** `{=x=}` /
> `{,x,}` / `{^x^}` only when intraword (e.g. `H<sub>2</sub>O` → `H{,2,}O`),
> where the brace form renders in every position (corpus
> `67-superscript-and-subscript`).

It also rewrites **GFM tables** to Carve's native form: a header row followed by
a `| --- |` delimiter row becomes `|=`-prefixed header cells, and the delimiter
row is dropped (Carve needs no separator). Column alignment from the delimiter
(`:--`, `--:`, `:--:`) is glued onto the header marker as `|=<`, `|=>`, `|=~`:

```md
| L | C | R |
| :-- | :--: | --: |
| a | b | c |
```

becomes

```
|=< L |=~ C |=> R |
| a | b | c |
```

Body rows are already valid Carve, so they pass through unchanged.

**A pipe row without a delimiter row stays text.** Carve reads any line that
begins and ends with `|` as a table row, with no delimiter row anywhere, so a
row GFM shows as a paragraph would otherwise become a table on migration:

```md
| a | b |
| c | d |
```

GFM renders that as one paragraph, and so does the migrated document - the
opening pipe of each line is escaped, which keeps the row literal and keeps it
in the paragraph it belongs to:

```
\| a | b |
\| c | d |
```

The same applies to every partly-formed table: a delimiter row with no header
above it, a header and delimiter whose column counts disagree, and a stray pipe
row before or after a real table. A table GFM does read - inside a block quote
or a list item as much as at the top level - is untouched.

> [!NOTE]
> A `---` kept as literal text still renders as an em dash, because Carve
> applies smart typography to prose. That is true of any `---` a migrated
> document carries, not only one inside a pipe row.

To go the other way - flagging a Djot document that would silently mis-render
under Carve - use `djotMigrationWarnings`, and to rewrite those collisions in
place use `applyMigrationFixes` (or the `carve fix` CLI below):

```ts
import { applyMigrationFixes } from '@markup-carve/carve'

const { output, applied, skipped } = applyMigrationFixes('use _emphasis_ here')
// output  -> 'use /emphasis/ here'
// applied -> the warnings that were spliced in (nested ones compose, so
//            **_x_** fixes to a single-star bold wrapping a slash emphasis)
// skipped -> crossing collisions (e.g. **_x**_) left for manual review
```

## Command line: `carve fix`

Installing the package provides a `carve` binary. Its `carve fix` subcommand
wraps `applyMigrationFixes` to rewrite Djot/Markdown delimiter collisions to
their Carve equivalents.

```sh
carve fix < in.crv > out.crv     # stdin -> stdout (default)
carve fix --write doc.crv …      # rewrite files in place
carve fix --check doc.crv …      # report only; exit 1 if any would change (CI)
carve fix --stdout doc.crv       # print the fix for one file, don't modify it
```

With no files it reads stdin and writes the fixed result to stdout. Nested
collisions compose (`**_x_**` fixes in one pass); only *crossing* collisions
that are genuinely ambiguous (e.g. `**_x**_`) are reported on stderr for manual
review. `--check` is a gate: it exits non-zero when a file would change or has
manual-review collisions, so it drops into a pre-commit hook or CI step.

## Linting

`djotMigrationWarnings` catches *source-level* delimiter collisions;
`lintCarve` catches *silent-failure* problems - markup that parses without
error but renders as the wrong thing, so nothing throws. Every rule here is
about Carve alone; for "does this document also mean the same thing in Djot"
see [Portability](#portability), which measures the answer rather than
linting for it.

```ts
import { lintCarve } from '@markup-carve/carve'

lintCarve('# Setup\n\n## Setup\n\nSee </#ghost>.')
// [
//   { rule: 'duplicate-heading-id', line: 3, ... },  // second "Setup" -> id setup-2
//   { rule: 'broken-crossref',      line: 5, ... },  // </#ghost> has no heading
// ]
```

| Rule | Catches |
| ---- | ------- |
| `duplicate-heading-id` | two headings producing the same id (slug collision or repeated explicit `{#id}`); ambiguous references resolve to the first |
| `broken-crossref` | a `</#id>` cross-reference with no matching heading or numbered caption id; it renders as literal text |
| `unresolved-reference-link` | a `[text][label]` or `[text][]` reference link with no matching link definition or implicit heading target; it renders as literal text |
| `unresolved-footnote` | a `[^label]` footnote reference with no matching `[^label]: ...` definition; it renders as literal text |
| `duplicate-footnote-definition` | a repeated `[^label]: ...` definition; the parser keeps the first definition and ignores the later one |
| `unused-footnote-definition` | a footnote definition that is never referenced; it is omitted from rendered output |
| `heading-trailing-attribute` | a trailing `{#id}` / `{.class}` on a heading line; under heading-strict this is literal text, so the attributes never attach (put them on a `{…}` line *above* the heading) |
| `raw-block-syntax` | a legacy `` ```raw FORMAT `` fence; the Carve raw block is `` ```=FORMAT ``, and the wrong form fails to open and desyncs the rest of the document's fences |
| `block-marker-as-text` | a line that opens like a block (`:::`, `{#`, `{.`) but parsed as a paragraph because the block never opened |
| `fence-delimiter-indentation` | an indented fenced-code delimiter (`` ``` `` / `~~~`); a Carve fence is column-exact and must sit at its container's content column (column 0 at the top level), so an indented run does not open a code block - it renders as inline code with the body as plain text |
| `blockquote-marker-without-space` | a `>` blockquote marker with no space after it. Carve requires the separator space, so the marker does not open a quote |

The `carve lint` CLI reports both the collision warnings and these lint
findings as `file:line:col rule - message`, and exits non-zero if anything is
found:

```sh
carve lint doc.crv …   # report; exit 1 if any finding (CI / pre-commit)
carve lint < doc.crv   # read stdin
```

### Platform rules (opt-in, default OFF)

Two further rules answer a different question: not "is this document right in
Carve" but "does a HOST mangle it after publication". No render-time construct
prevents a host from re-linkifying published output, so a bare `#123` becomes a
link to an unrelated issue and a bare at-word becomes a mention that notifies
an uninvolved person. The source is the only place the author's intent still
exists.

They are **off by default** and enabled per platform, because unlike every rule
above they are target-specific - an over-eager rule people disable wholesale
would be worse than none.

```ts
lintCarve(src)                            // never emits a platform rule
lintCarve(src, { platforms: ['github'] }) // opts in
```

```sh
carve lint --platform github doc.crv   # repeatable; an unknown name is an error
```

| Rule | Catches |
| ---- | ------- |
| `platform-mention-token` | an at-prefixed word (`@minutely`, `@param`, `@property`, `@types/node`) outside a fenced block; the host turns it into a mention that notifies whoever owns that handle |
| `platform-issue-reference` | a hash-number (`#1`, `#123`) outside a fenced block; the host turns it into a link to an unrelated issue, and posts a backlink there |

Two ids rather than one, because the two token shapes have different
false-positive profiles and an author will want to silence one without the
other.

They look in prose **and in inline code spans** - those are not reliably safe,
since some host surfaces (a pull-request list, a commit log view) still linkify
inside them. They do not look in fenced code blocks, which are reliably safe,
nor in raw blocks or comments, nor in text that is never published: frontmatter,
link and abbreviation definitions, an unreferenced footnote definition, and an
inline link's destination. A token inside a URL is part of that URL, so nothing
in a bare URL's path, query or fragment is flagged either. A captioned
listing's **caption** and a *referenced* footnote's body are published, so both
are checked. The suggested fix in each message is to move the
example into a fenced block, strip the sigil and rephrase, or rewrite an
enumerated reference as "item 1" / "point 1".

## Portability

Linting answers "is this document right in Carve". A different question comes
up when a file has to survive both readers - a README rendered by Carve here
and by a Djot processor somewhere else: **does it mean the same thing in
Djot?**

That one is not a lint. It was tried as one (carve-js#546): a rule reasoned
about when a block opener would be absorbed into a paragraph by Djot but not by
Carve. The divergence it described is real, but the rule tested a property of
the *Carve* tree while the divergence is a statement about *Djot's* block
model, and the two came apart on documents where Djot absorbs the paragraph
into something before it. Measured false positives ran from 11.5% to 36.5%
depending on the generator, and its advice - "add a blank line" - changed the
Carve document in the cases it got wrong.

So `carve portability` does not reason about it. It renders the document with
both engines and reports the first place they disagree:

```sh
carve portability doc.crv     # exit 0 portable, 1 diverges
carve portability --json *.crv
```

```
doc.crv:1: diverges from Djot
  carve: </p><blockquote><p>A quote.</p></blockquote>
  djot:   &gt; A quote.</p>
```

It needs djot.js, which Carve does not depend on - install it alongside:

```sh
npm install @djot/djot
```

Two things to expect from the output:

- **Carve's deliberate departures are divergences.** `/italic/`, `=mark=` and a
  quoted link title mean something else in Djot, so a document using them is
  reported. That is the honest answer to the question being asked, not noise -
  but it does mean a Carve-flavored document is rarely portable, and the check
  is most useful on prose you intend to keep neutral.
- **Only the first divergence is reported.** Once the engines disagree about a
  block boundary everything after it is displaced, so the rest of the report
  would restate one difference as many.

Differences in how the two renderers *write* the same document are not
divergences: attribute order, a boolean attribute spelled `disabled` or
`disabled=""`, a self-closing slash, and whitespace at a block boundary are all
normalized away first. Whitespace between inline siblings and inside `` <pre> ``
is content and is compared as-is.

Programmatically the engine is injected, so importing `@markup-carve/carve`
never pulls in a Djot parser:

```ts
import { checkPortability, carveToHtml } from '@markup-carve/carve'
import { parse, renderHTML } from '@djot/djot'

const report = checkPortability(
  source,
  { parse, renderHTML },
  (src) => carveToHtml(src, { sourceLine: true }),
)
// { portable: false, divergence: { line: 1, carve: '…', djot: '…' } }
```

The `sourceLine` render option is what lets the report name a line: the check
reads Carve's own `data-source-line` output and drops it before comparing, so
the line comes from the parser rather than from a guess about the source.
