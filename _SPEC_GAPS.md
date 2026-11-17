# Carve 0.2 specification gaps

Ranked by the cost of changing the contract after a freeze. The `carve` checkout was read only.

## Freeze candidate 4 session (spec `011cb22e`)

Cases found while following freeze candidate 4. The engine choice is named in each.

### G-E1. `data/inline-atoms.json` lets `_` start a raw format name

C2-I-021: "The name is a raw format name (C2-B-225)." C2-B-225: "A raw format name starts with an ASCII letter", and `raw_format` in `data/line-shapes.json` has `not_first: ["-", "0-9", "_"]`. Inline Example 123 says `` `x`{=_a} `` is code and the text `{=_a}`. But the `suffix_name` of `raw_inline` in `data/inline-atoms.json` still has `"first": ["A-Z", "_", "a-z"]`.

The engine follows the clauses: the inline scan takes the first and the further characters from `raw_format` of `data/line-shapes.json` (`scripts/generate-inline.ts`). The data row should drop `_` from `first`.

### G-E2. A span mark cell has no children, and C2-A-091 refuses a cell with none

C2-A-091: "A reader refuses a cell with no children". C2-A-092: "a valid mark cell stays empty", and blocks Examples 208, 251 to 253 and writer Example 7 hold mark cells with `"children": []`. Read literally, C2-A-091 refuses every parsed table with a span.

The engine reads the refusal as one of a cell without `span`: an empty ordinary cell is one empty `cell_paragraph`, a mark cell has no children. C2-A-091 should say "a cell without `span` that has no children".

### G-E3. The writer case of C2-W-044 for a start of more than nine digits cannot occur

C2-W-044: "for a supplied tree the writer writes the list from 1 and reports `field-unspellable`". Freeze candidate 4 bounds `marker.start` to 0 to 999999999 in the schema (refused tree `marker-start-out-of-range`), so the reader refuses that tree before a writer sees it. The engine refuses it; the writer sentence of C2-W-044 can go, or say that only a writer that skips the reader checks meets it.

### G-E4. The fallback bound of C2-A-132 counts nodes that C2-A-124 refuses

C2-A-132 bounds "fallback nesting to 32 unqualified inline extension nodes". C2-A-124 now refuses every field but `name`, `children` and the common fields on an unqualified inline extension, `fallback` among them, and a qualified fallback holds no extension node (C2-A-126). So no valid tree nests a fallback at all, and the bound only decides which refusal message a deep tree gets. The engine keeps the bound; the clause can drop it.

### G-E5. Contract entry U-184 no longer holds after C2-H-133

`data/upgrade-map.json` U-184: `- {{ e }}` becomes `- \{{ e }}`, with `meaning02` `<li>` and `<p>{{ e }}</p>` on its own lines. C2-H-133 now writes the unexpanded include of a tight item bare (html Example 64), so 0.2 renders `<li>{{ e }}</li>` as 0.1 does, and the upgrade tool, which escapes only where the HTML differs, leaves the line as it is. Either U-184 becomes `none` (the HTML agrees), or it stays an escape for the reason that a resolver would expand the 0.2 include; the row should say which. The contract test pins the tool's output (`DOES_NOT_HOLD`).

## Freeze candidate 2 session (spec `e1f3c5a2`)

Cases found while following freeze candidate 2, revision 1, and the third review. The engine choice is named in each.

### G-D1. Which records a `lines` or `region` selection of a table include chooses

C2-N-047: "a `lines` or `region` selection chooses records and never makes a new head". C2-N-036: "A slice that cuts a fence, a list or a div ends that construct at the end of the slice." Neither says which records a line range chooses when a quoted field crosses its edge.

File `a.csv`:

```csv
H
"x
y"
z
```

```carve
{table}
{{ a.csv @lines:2-2 @code:csv }}
```

Reading A (the engine): a selection chooses the records of the whole file that start on a selected line, so line 2 chooses the record `x` / `y` whole, and the cell holds both lines. Reading B: the selected lines are read as records on their own, so the quoted field is cut, malformed, and its cell holds `x` with `delimited-table-malformed`. Reading A follows "chooses records", and the head and foot of C2-N-046 are records of the whole file in both readings.

### G-D2. A supplied `keyValues` key that is no key (security)

C2-A-032: "Each pair is a list of two strings, the key and its value". C2-I-030 defines a key for the parser only, the schema refuses only `id` and `class`, and no reader check of C2-A-188 tests the characters of a key. C2-H-003 escapes values, not names; C2-H-161 drops names that start with `on`.

```json
{"type":"document","astVersion":"2.0","children":[{"type":"paragraph","attrs":{"keyValues":[["x onclick","alert(1)"]]},"children":[{"type":"text","value":"x"}]}]}
```

Reading A (the engine, unchanged): `validateTree` accepts it and the render writes the key as it stands, `<p x onclick="alert(1)">x</p>`; the key `a><script>alert(1)</script` writes a script element with `rawHtml` off. The empty key writes `<p ="v">`. The writer already leaves such a key out. Reading B: a reader refuses a key that is not a key by C2-I-030, or the render drops it. Third review F5 proposes B with a row in `trees/refused.json`. Not changed, since no clause decides it; this one is the most urgent of the list.

### G-D3. A note reference whose `href` has no fragment

C2-M-062: an `<a>` with `role="doc-noteref"` "is a `footnote_ref` whose key is that of the note its `href` names, or else its fragment without the prefixes of C2-M-061".

```carve
[x](/u){role=doc-noteref}
```

The render writes `<p><a href="/u" role="doc-noteref">x</a></p>`. `/u` names no note and has no fragment, so the clause gives no key. Reading A (the engine, unchanged): the key is the whole `href`, and the import writes `[^/u]`. Reading B: without a note and a fragment the element is no note reference and takes the mapping of any `<a>`, a link that keeps `role`. Reading B keeps the tree of the source.

### G-D4. `dir` outside a figure (third review F4)

C2-A-031 makes `dir` a field of every node that carries `lang`; html.md writes it only on the `<figure>` of a captioned block (C2-H-063). `<p dir="rtl">x</p>` imports with `dir` and renders `<p>x</p>`. The engine is unchanged until F4 is ruled; the defect list names it a defect only under a ruling toward writing the field.

Ruled at `011cb22e`: C2-H-009 and C2-H-013 write `dir` after `lang` on every element that carries the node's attributes. Done in the freeze candidate 4 session.

## Corpus session (spec `0d422808`)

Cases where neither clause decides, found while running the conformance corpus. The engine choice is named in each.

### G-C1. A captioned paragraph alone in a list item or a description

C2-H-062: "An image paragraph, a code block, a quote or a math block that carries a caption (C2-A-082) is written as `<figure>` around the block and then `<figcaption>` with the caption." C2-H-007: "A list item whose only block is one paragraph, bare or wrapped, is written on one line. ... A display math paragraph is one, and is written on one line." C2-H-040: "A description with one visible block writes a paragraph bare." C2-H-006 has the carve-out ("one paragraph without a caption") for a quote; C2-H-007 and C2-H-040 have none.

```carve
- $$`x`
  ^ cap
```

Reading A (the engine now, as for the quote of C2-H-006 and CC-069): the captioned paragraph is a figure on its own lines inside the item, with `<p>` inside the figure.

```html
<ul>
  <li>
    <figure>
      <p><span class="math display" role="math">\[x\]</span></p>
      <figcaption>cap</figcaption>
    </figure>
  </li>
</ul>
```

Reading B: C2-H-007 and C2-H-040 apply as written, and the item holds the bare math on one line. Then the caption has no place, and C2-H-062 is broken; before this session the engine wrote reading B and dropped the caption with no report. The same holds for `:: t`, then `: $$`x``, then `  ^ cap`. A clause that extends the C2-H-006 carve-out to C2-H-007 and C2-H-040 settles it.

### G-C2. Edge whitespace of a delimited-table cell is lost, and no row says so

Settled at `e1f3c5a2`: C2-H-195 row 16 lists the loss, and the importer's round-trip harness applies it.

C2-M-018: "At the start and at the end of the inline content of a block, whitespace of every kind is removed". C2-M-011 counts a cell that holds no block element as inline content. C2-H-196: "A tree fact that neither the table of C2-H-186, nor C2-H-119, C2-H-193, C2-H-194 or the table of C2-H-195 names is expected to survive a render with `roundtrip` and an import".

Input (block chapter example source, through `roundtrip` render and import):

````carve
{table}
```csv
a,"b ""q"" c", d
```
````

The render writes `<th scope="col"> d</th>`. Reading A (C2-M-018, the importer now): the cell text is `d`, so the leading space is lost, which C2-H-195 does not list. Reading B: a cell keeps edge spaces (C2-M-018 exempts cells, or a carrier is needed). Either C2-H-195 gains a row (delimited-table cell value with edge whitespace) or C2-M-018 gains an exception. The importer follows C2-M-018; `import/test/carriers.test.ts` holds that one example out by name.

### G-C3. Codes of the Markdown and Djot importers

C2-M-080 to C2-M-083 define the codes of the HTML importer only. The Markdown and Djot importers of `carve-js` still report `import-degraded` and `import-unsupported`, which `data/lint-rules.json` no longer lists. Reading A: they adopt the seven codes (with the closest meaning). Reading B: they are out of 0.2 scope and keep their own codes, which the catalog then lists. Not changed in this session.

### G-C4. One-item list whose item holds two blocks

C2-M-033: "A list is also loose when an item holds more than one block that is no list. Otherwise it is tight. A list with one item is tight (C2-B-062)." `<ul><li><p>a</p><p>b</p></li></ul>`: the second sentence makes it loose, the last tight. The importer takes the last sentence as the exception (tight), which C2-B-062 supports; the writer spells a tight one-item list with two paragraphs without loss. The clause would read clearer with "Exception" or "even so".

## Earlier sessions

### 1. Reference link schema still requires a retired field

The `link` and `image` schemas use `dependentRequired` to require `form` beside `key` and `namespace`. C2-A-050 and C2-A-105 use `refForm` instead. The engine produces the specified `refForm` shape. In the CI-sized 100,000-mutant run of `spec2-ast-crosscheck.mjs`, this accounted for all 50 source-produced schema failures and 416 of 433 mutant disagreements. The raw script exits with failure; the repository's explanation gate accepts these known differences and reports zero unexplained disagreements. The engine cannot add the retired field without violating the tree contract.

```json
{"type":"document","astVersion":"2.0","children":[{"type":"paragraph","children":[{"type":"link","key":"a","namespace":"link","refForm":"full","children":[]}] }]}
```

### 2. Renderer output is an HTML string

C2-X-034 requires host escaping and URL policy. The public renderer receives host helpers for text, attributes, child lists and generated ids, and the shipped tabs renderer uses them. A third-party renderer can still return arbitrary HTML, which the host cannot reliably inspect and repair. Enforcing the rule for untrusted renderer code would require a structured output API.

### 3. Third-party slot traversal has no schema context

The generated slot table fixes traversal order for the standard tabs extension. A supplied node of another registered extension is traversed in the order of keys in its `slots` object, which can differ from its registration's slot declaration order under C2-X-020. The walker API would need the extension registry or a separate order record to make this independent of object key order.

### 4. Fallback nesting clauses overlap

C2-X-022 and C2-A-126 require qualified extension fallbacks to contain only core nodes. C2-X-030 separately sets a limit for nested extension nodes on a fallback path. The validator enforces core-only qualified fallbacks and still bounds the legacy unqualified inline extension fallback path to 32. The specification should say whether C2-X-030 applies only to that legacy path.

### 5. Annotation sidecar references need a paired reader API

C2-A-203 and C2-A-206 require checking annotation ids against a separate range sidecar. The tree reader accepts a tree alone, so it validates the `carve.annotation` value schema and duplicate ids but cannot prove that a range exists. A sidecar-aware reader or validator signature is needed to enforce those clauses.

### 6. Other pre-existing schema differences

The AST schema accepts a position with its start behind its end and an extension name without a declaration; the engine refuses both under C2-A-140 and C2-A-123. It does not encode the tree nesting bound. The schema rejects an unqualified inline extension whose name starts with underscore, although C2-I-094 permits it. It also rejects an out-of-shape include `lines` range retained for expansion under C2-B-206. These were already present before the extension work. The remaining 17 mutant disagreements in the CI-sized run fall into these categories.
