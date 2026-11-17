# Example fixes for the specification

**Status at `e1f3c5a2` (freeze candidate 2, revision 1):** the corpus corrects F1 to F6, every hold is gone, and no example of the pinned corpus departs from its clause. F7 is prose under examples, which the runner does not check.

Examples of `spec/0.2` whose stated result departs from its own clause, found by running the conformance corpus (`spec/0.2/conformance`, pinned at `0d422808`) through the 0.2 engine. The engine follows the clause. Each entry is held by name in the corpus runner (`v2/scripts/corpus-held.ts`, `import/test/corpus.test.ts`); a held field must keep failing, so the hold goes when the corpus is corrected.

## F1. `syntax-blocks.md` Example 52: `expected.diagnostics`

Input:

```carve
- item text
  - child
  3. also a child list
```

Stated in the corpus: `"diagnostics": ["deprecated-spaced-thematic-break"]`.

The code comes from the paragraph above the example, which is about another shape: "A spaced run such as `- - -` reads as nested markers that end in a lone hyphen (C2-B-058, C2-B-061), and `deprecated-spaced-thematic-break` reports it." The input has no spaced run. C2-B-058 decides it: "A marker line that holds another marker with content has a nested list as the item's first block."

Clause-correct: no `diagnostics` field, or `[]`. The engine reports nothing; the HTML and the tree of the example are right. The corpus generator should not take codes from a paragraph about a different input, or the code belongs on Example 56 (`- - -`), which the engine reports.

## F2. `syntax-blocks.md` Example 90: `expected.diagnostics`

Input:

```carve
{.x}
para
```

Stated in the corpus: `"diagnostics": ["block-opener-without-blank-line"]`.

The code comes from the sentence above the example: "Directly after a paragraph line an attribute line is a lazy line (C2-B-012), and `block-opener-without-blank-line` reports it." Here the attribute line stands before the paragraph, so C2-B-090 applies and no lazy line exists.

Clause-correct: no `diagnostics` field, or `[]`. The engine reports nothing; HTML and tree are right. Example 95 (`text`, then `{.x}`) is the shape the sentence describes.

## F3. `import-html.md` Example 2 (verified): children and source

Input, imported with no option:

```html
<p><span data-carve-raw="html">&lt;b&gt;</span> and <span class="c">x</span></p>
```

C2-M-066: "The importer reads the option `rawHtml` of C2-H-137, whose default is off. With it off, every comment, every element of the treatment `raw` and every `data-carve-raw` span (C2-H-186) is dropped with its content and attributes, and each is reported with one `import-element-dropped` entry".

Stated: a `raw_inline` `<b>`, the text ` and `, the span `x`; source `` `<b>`{=html} and [x]{.c} ``. That was the output of the importer at `cd8e431b`, before it had the option, and it is the output with `rawHtml` on.

Clause-correct with the default (the engine gives it), the leading space removed by C2-M-018:

```json
[{"type":"paragraph","children":[{"type":"text","value":"and "},{"type":"span","children":[{"type":"text","value":"x"}],"attrs":{"classes":["c"]}}]}]
```

```carve
and [x]{.c}
```

with `import-element-dropped` (`foreignType` `span`) and `import-whitespace-normalized`. The smaller fix: mark the example `import option rawHtml on`; the stated output is then what the engine gives.

## F4. `import-html.md` Example 34: `expected.diagnostics`

Stated in the corpus: `["field-unspellable"]`, from the prose below the example: "The importer leaves out the final line feed of both raw blocks, which the writer reports as `field-unspellable`." C2-M-065: "A raw block value ends with a line feed (C2-A-045, C2-A-048)." The stated tree holds the line feed, and the writer spells it without a report.

Clause-correct: `[]`; the sentence describes the importer before this session and can go. Tree and source of the example are right.

## F5. `import-html.md` Example 36: `expected.diagnostics`

Stated in the corpus: `["structure-unspellable"]`, from the prose: "The importer keeps the empty paragraph and the empty strong, which the writer reports as `structure-unspellable`." C2-M-069: "A `paragraph`, `heading` or `definition_term` with no content after the rules of this document is dropped. So is an inline node that needs content and has none ... A drop that loses an attribute is reported with `import-structure-repaired`; one that loses nothing is not reported."

Clause-correct: `[]`. Tree and source of the example are right.

## F6. `data/import-html.json`, the row of `import-element-dropped`

`reports` reads "... and with `rawHtml` off every comment and the treatment `raw`". C2-M-066 and the code table of C2-M-083 add every `data-carve-raw` span; `data/lint-rules.json` already says so. The data row lags its clause.

## F7. Prose under the import examples

The sentences under Examples 4, 7, 13, 30, 31, 33, 35, 39, 41 and 42 state what the importer did before this session ("The importer ..."). The importer now gives the stated tree and source of each, so those sentences can go and the examples can be marked verified at the carve-js commit of this session.
