# Carve 0.2 specification gaps

Ranked by the cost of changing the contract after a freeze. The `carve` checkout was read only.

## Freeze candidate 8 session (spec `6bdc5a26`)

Cases found while moving from freeze candidate 6 to 8. The engine choice is named in each.

### G-H1. Does `ABBR` merge with `abbr` in one attribute block?

Input (html.md Example 80):

```carve
[x]{KBD} and [y]{abbr="a" ABBR="b"}
```

Reading one, C2-A-035: "Names are the same when they agree without regard to ASCII letter case, within one block", so the later `ABBR="b"` replaces the value of `abbr` and `keyValues` is `[["abbr", "b"]]`, which renders `<abbr title="b">y</abbr>`. The stored tree of the example says exactly this.

Reading two, C2-H-013: the keys `abbr`, `time` and `kbd` "are no attribute names in this sense: they match in lower case only, and a key in another case is an ordinary attribute", so the two keys stay apart and the render is `<abbr title="a" ABBR="b">y</abbr>`, as the stated HTML says. That needs a tree with both keys, which C2-A-035 and the reader's duplicate check (C2-A-035, last sentence) refuse.

The engine follows C2-A-035 for the tree; its HTML follows from that tree. The HTML field is held (`_EXAMPLE_FIXES.md` F13). One sentence in C2-A-035 naming the three keys as an exception, or a different example input, closes it.

### G-H2. A degraded cross-reference to a degraded heading

Input (html.md Example 34, profile `comment`; CC-358 is the same shape under `minimal`):

```carve
## Sub *em* `code`

[Sub em code][] and </#Sub-em-code>
```

Both profiles degrade the heading and the cross-reference.

Reading one, C2-H-177: a cross-reference "that resolved to it [is] written in [its] unresolved form [...] as if the heading did not exist", so the text is `</#Sub-em-code>`. Example 34 states this.

Reading two, C2-H-165 (the P1-a ruling of lane 30): a degraded "resolved `xref` [is written] as the text it writes in its link (C2-H-096) and an unresolved one as typed", so the text is `Sub em code`. CC-358 states this for `# H` and `</#H>`. Resolution does not read the profile (C2-H-177, first sentence), so the cross-reference is resolved.

No built-in profile keeps headings and degrades cross-references, so under reading one the C2-H-165 sentence would never apply. The engine follows reading two, the newer ruling: a degraded cross-reference writes its link text, and one the profile keeps writes its typed form when its heading is degraded. Example 34 is held on `html` (`_EXAMPLE_FIXES.md` F14).

### G-H3. A semantic key in another case does not survive a roundtrip render

Input (html.md Example 80):

```carve
[x]{KBD}
```

C2-H-013 and C2-H-075 make `KBD` an ordinary attribute, `<span KBD="">x</span>`. An HTML parser lowers attribute names, so the importer reads `kbd`, which C2-M reads as the key that makes `<kbd>`: the roundtrip of C2-H-186 gives another tree. Reading one: accept it as a listed loss of C2-H-195. Reading two: a carrier keeps the case of such a key. The engine follows reading one in its roundtrip test, which holds the source by name.

## Freeze candidate 6 session (spec `068552fc`)

Cases found while moving to freeze candidate 6 and its restores. The engine choice is named in each.

### G-G1. Example 231 keeps a region marker inside a paragraph

The stored tree of syntax-blocks Example 231 (corpus and `trees/examples-syntax-blocks.json`) holds `%% #endregion intro` as an inline comment of the paragraph `See [c]().`. C2-B-137 says a region marker line "ends every open paragraph", and C2-B-024 excludes it from the lazy lines. The engine follows the clause; the tree field is held (`_EXAMPLE_FIXES.md` F9).

### G-G2. Examples 278 and 282 list an `includeExpansion` stage

Both stored trees state `stages: ["includeExpansion", "referenceResolution", "tableAlignment"]`, though neither input holds an include and no option is set; the other 500 such examples state two stages (C2-N-006). The engine writes two stages; the field is held (`_EXAMPLE_FIXES.md` F10).

### G-G3. No carrier keeps a cross-reference key typed in another normal form

C2-I-097 matches a cross-reference key under NFC and keeps the key as typed, so `</#Café>` with a decomposed `é` resolves to the id `Café` and the `href` names the id. The `data-carve-xref` carrier (C2-H-011) reads the key back from the `href`, so the typed form is lost on import. Inline Example 126 is the case. Reading one: the carrier should take the key as its value where it differs from the id. Reading two: the difference is an accepted loss and the import table should list it. The roundtrip test holds this one source by name.

### G-G4. No carrier spells the bodies of `body-rows` or `rowHeadColumns`

C2-B-230 splits a body into several `table_body` nodes and sets `rowHeadColumns`; HTML writes one `<tbody>` per nonempty body and the first columns as `<th scope="row">` (C2-H-056), and never writes the keys (C2-H-153). The import of a `roundtrip` render cannot tell an empty body, nor a row header column from a header cell. The roundtrip test holds blocks Example 277 by name. A carrier on `<tbody>` (for example `data-carve-row-heads`) would close it.

### G-G5. U-224 is withdrawn, but three of its contract inputs still differ

The upgrade map at `068552fc` drops U-224 (TODO: "drop U-224") after C2-B-109 closes a comment block at a bare closer line. Two of the five contract inputs now read the same in 0.1 and 0.2, but `- ::: box` / `%%%%` / `%% j`, the description list one and the footnote one (`U-224#1` to `#3`) still render differently. The tool keeps reporting U-224 for them so that no difference goes unexplained.

### G-G6. C2-W-034 and the blank line before a region marker

At candidate 6 a region marker line ends the paragraph above it (C2-B-137), so `a` / `%% #endregion` is a paragraph and a comment node. C2-W-034 says the writer "moves no marker and opens no new line beside one". The tree is the same whether the source had a blank line between them or not, so the writer cannot keep both layouts. The writer separates the two blocks with a blank line (C2-W-017), the same as with any other block pair, and the include vector `i01b` now expects that form.

### G-G7. No machine-readable list of render-loss codes

`carve2 render --allow-loss CODE` must refuse an unknown code, but neither `spec/0.2` nor its data lists the codes of the `render-loss` channel. The command line keeps a hand-written list (`RENDER_LOSS_CODES` in `v2/cli/run.ts`) that has to follow the spec by hand.

### G-G8. C2-W-097 and inline syntax in alt text

C2-W-097 escapes only a bracket "that has no partner in the alt text". In the alt text `[^]]` every bracket has a partner, yet `![[^]]]()` does not read back as an image: `[^]` reads as an empty footnote label and ends the image text early. The same holds for `[^}]{#]`, where the pair `[^}]` and a later `{#` read as a footnote reference and a comment. The engine escapes a `]` that directly follows `[^`, and when a later `]` has no partner it escapes the `]` of the `[^` pair instead, so the `[` takes the later one: `![[^\]]]()` and `![[^}\]\{#]]()`, which are what the reader takes as those alt texts. A code span or braced comment in alt text is raw: its brackets take no part in the pairing, and an opener of one with no closer in the alt text takes a backslash, since the reader would otherwise close it behind the image (`a\`b` before a later backtick, `{#b` before a later `#}`).

## Freeze candidate 5 session (spec `7db33836`)

Cases found while following freeze candidate 5, revision 1. The engine choice is named in each.

### G-F1. No upgrade row covers a bare header mark that 0.1 read as text

`|=|` in 0.1 renders `<td>=</td>`. C2-B-171 lets the header mark end at the cell end, so 0.2 reads an empty header cell. U-185 covered this as an escape and is withdrawn at `7db33836`; no other row of `data/upgrade-map.json` names it, and U-270 covers only a mark glued to text (`|=a|`), whose meaning did not change. Reading one: the meaning changed and the tool must escape it, as every C-class change requires. Reading two: the withdrawal means the case is accepted as a silent change. The tool takes reading one and keeps the escape `|\=|` as its own extension entry X-003, which leaves the output identical to the withdrawn row.

### G-F2. C2-H-168 refuses a `renderers` option that C2-H-123 and C2-X-033 define

The last sentence of C2-H-168 says "A `renderers` option that is not empty is refused in 0.2.0, which has no build-time renderer to call." C2-H-123 says `renderers` "maps an extension name to a build-time renderer and is read only in static mode", C2-X-033 lets a host register a renderer by qualified name and version, and C2-X-043 specifies the tabs renderer. Reading one: the sentence means a math renderer only, which 0.2.0 does not have. Reading two: every nonempty `renderers` is refused, which removes the extension renderers. The engine takes reading one and keeps accepting extension renderers; the sentence should name math.

### G-F3. UPGRADING.md says the engine has no migration function

UPGRADING.md (the paragraph on stored 1.x JSON, and "Tooling not yet shipped") says "The current 0.2 engine has no migration function for stored 1.x or draft JSON." carve-js ships one in `v2/migrate/` and as `carve2 migrate-ast`, and C2-A-015 and C2-A-176 require it. The sentence and the list item are stale. The same paragraph says "Keep `pos` byte offsets only if they still match the original source"; 0.1 offsets count code points, so the tool converts them when the source is given and otherwise drops them with a `migration-loss` when the tree holds text past ASCII (C2-A-141).

## Freeze candidate 4 session (spec `011cb22e`)

Cases found while following freeze candidate 4. The engine choice is named in each.

### G-E1. `data/inline-atoms.json` lets `_` start a raw format name

Closed at `7db33836`: `suffix_name.first` is `["A-Z", "a-z"]`.

C2-I-021: "The name is a raw format name (C2-B-225)." C2-B-225: "A raw format name starts with an ASCII letter", and `raw_format` in `data/line-shapes.json` has `not_first: ["-", "0-9", "_"]`. Inline Example 123 says `` `x`{=_a} `` is code and the text `{=_a}`. But the `suffix_name` of `raw_inline` in `data/inline-atoms.json` still has `"first": ["A-Z", "_", "a-z"]`.

The engine follows the clauses: the inline scan takes the first and the further characters from `raw_format` of `data/line-shapes.json` (`scripts/generate-inline.ts`). The data row should drop `_` from `first`.

### G-E2. A span mark cell has no children, and C2-A-091 refuses a cell with none

Closed at `7db33836`: C2-A-091 refuses "a cell with no children that carries no `span`".

C2-A-091: "A reader refuses a cell with no children". C2-A-092: "a valid mark cell stays empty", and blocks Examples 208, 251 to 253 and writer Example 7 hold mark cells with `"children": []`. Read literally, C2-A-091 refuses every parsed table with a span.

The engine reads the refusal as one of a cell without `span`: an empty ordinary cell is one empty `cell_paragraph`, a mark cell has no children. C2-A-091 should say "a cell without `span` that has no children".

### G-E3. The writer case of C2-W-044 for a start of more than nine digits cannot occur

Closed at `7db33836`: C2-W-044 now says a reader refuses a start of more than nine digits (C2-A-056).

C2-W-044: "for a supplied tree the writer writes the list from 1 and reports `field-unspellable`". Freeze candidate 4 bounds `marker.start` to 0 to 999999999 in the schema (refused tree `marker-start-out-of-range`), so the reader refuses that tree before a writer sees it. The engine refuses it; the writer sentence of C2-W-044 can go, or say that only a writer that skips the reader checks meets it.

### G-E4. The fallback bound of C2-A-132 counts nodes that C2-A-124 refuses

Closed at `7db33836`: the prose under C2-A-132 says the bound counts only the unqualified path.

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
