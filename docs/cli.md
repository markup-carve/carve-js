# Command line


The package installs a `carve` binary. Rendering is the default action — it
reads a file or stdin and writes the rendered output to stdout. HTML is the
default; pass a format flag for Markdown, plain text, or ANSI:

```bash
carve README.crv > README.html   # HTML (default)
carve --markdown README.crv      # Markdown
carve --plain README.crv         # plain text
carve --ansi README.crv          # ANSI-colored terminal text
carve --carve README.crv         # canonical Carve source (formatter)
echo '# Hello' | carve           # render from stdin
```

`--html` / `--markdown` (`--md`) / `--plain` (`--plain-text`) / `--ansi` /
`--carve` select the format (the explicit `render` subcommand also works:
`carve render --ansi`). For anything you did not author, add `--safe` and
optionally `--profile` - see [Untrusted input](#untrusted-input). Three more
subcommands round out the tooling:

```bash
carve fmt  file.crv        # print canonically formatted Carve to stdout
carve fmt -w   file.crv    # format in place
carve fmt --check src/     # exit non-zero if any file is not formatted (CI gate)
carve fmt --stamp file.crv # also append a provenance marker (spec version + engine)
carve fix  file.crv        # auto-fix Djot/Markdown delimiter collisions
carve lint file.crv        # validate: collisions + silent-failure problems
carve diff a.crv b.crv     # semantic changes, ignoring source reflow
carve merge base.crv ours.crv theirs.crv # merge independent edits
carve portability file.crv # report where the document reads differently in Djot
carve --help
```

`carve fmt` rewrites Carve into a canonical form: it strips trailing whitespace,
collapses blank-line runs, normalizes list markers (`-`), heading hashes, fence
lengths, and attribute spacing. It is conservative (no reflow, no reference/inline
link conversion, no list renumbering) and semantic-preserving - the rendered HTML
is byte-identical before and after - so it is safe to run on a whole tree. The
same canonical serializer is available programmatically as `carveToCarve(src)`.

`carve fmt --stamp` additionally appends a *provenance marker* - a comment at the
end of the document recording the Carve spec version it was processed under and
the engine that wrote it:

```
%% carve-version: 0.1; generated-by: carve-js 0.1.0
```

It is deterministic (no timestamp) and replace-in-place, so re-stamping is
idempotent; it renders nothing and a plain `carve fmt` preserves it. Use
`--stamp-block` for the multi-line `%%%` block form. The same logic is available
as `stampCarve(formatted, 'carve-js 0.1.0')`.

The marker is machine-readable, so flagging documents that predate a breaking
spec change does not have to be done by eye:

```bash
carve --stamp-info doc.crv    # report the version and the writer
carve --stamp-check doc.crv   # exit 1 when the document predates this spec version
```

`--stamp-check` works as a CI gate over a directory of stored documents. An
**unstamped** document counts as needing review: its provenance is unknown, and
assuming it is current is the unsafe direction. Programmatically, `readStamp(src)`
returns `{version, generatedBy}` or `null`, and `needsReview(src)` answers the
same question as the flag.

Both marker forms are read, and a marker written by another implementation reads
the same - that is the point of recording it. What to do with the answer is the
[versioning contract](https://markup-carve.github.io/carve/versioning): only
`[behavior]` changelog entries between the stamped version and yours can require
a document change.

`carve diff` compares the normative PART 12 trees rather than source lines, so
rewrapping and re-indenting are not changes while an edited destination,
attribute, node, or node order is. `--json` returns stable paths and change
kinds for applications.

`carve merge` performs a conservative three-way merge over the same exchange
tree. Give it the common base followed by the two revisions; independent edits
are written as canonical Carve source. Ambiguous edits exit 1 and name their
JSON Pointer paths instead of choosing a winner. `--json` emits either the
merged AST or the complete conflict list. Concurrent insertion, deletion,
reordering, and a move on one side plus an edit on the other are reconciled by
node identity and order constraints; contradictory orders and delete-vs-edit
remain conflicts. Duplicate siblings are occurrence-matched, with a bounded
linear fallback for very large ambiguous lists.

Programmatically, `mergeAst(base, ours, theirs, { resolve })` lets an application
resolve selected conflicts as `base`, `ours`, `theirs`, or a supplied value.
`createAstPatch(before, after)` and `applyAstPatch(ast, operations)` provide a
serializable, position-independent patch format for storing or transporting the
same semantic edits. Merged and patched trees omit positions and serialize to
canonical source: the PART 12 AST does not contain the source-layout sidecar, so
claiming whitespace-preserving merge from those three trees would be false.

`carve lint` is a validator for problems that *parse* but render as the wrong
thing (so nothing throws): broken `</#id>` cross-references, duplicate heading
ids, unresolved reference links, missing/duplicate/unused footnotes, a trailing
`{…}` on a heading (literal text, not an attribute block), a legacy
`` ```raw FORMAT `` fence (use `` ```=FORMAT ``), a line that opens like a block
(`:::`, `{#`) but parsed as plain text, and a document declaring a Carve version
this engine does not implement. It exits non-zero when it reports anything, so it
works as a CI gate. The same checks surface live in editors
through [carve-lsp](https://github.com/markup-carve/carve-lsp).

`carve portability` answers a different question: not "is this right in Carve"
but "does it mean the same thing in Djot" - for a document that has to survive
both readers. It renders with both engines and reports the first place they
disagree, so it is a measurement rather than a heuristic; a first attempt that
*reasoned* about the same question as a lint rule was withdrawn for
unsoundness (carve-js#546). Carve's deliberate departures (`/italic/`, `=mark=`,
quoted link titles) are genuine divergences and are reported as such. It needs
djot.js, which this package does not depend on - `npm install @djot/djot`
alongside. See [Portability](migration.md#portability).

`carve-version-unsupported` reads a frontmatter `carve-version:` key - the
author-facing declaration of which Carve version a document targets - and warns
when it is newer than this engine implements, since constructs added after that
version will not render as intended. Declaring one is optional. A document with
no frontmatter key falls back to the trailing `%% carve-version:` provenance
marker, so anything `carve fmt --stamp` has touched is covered too; when both are
present the author's declaration wins.

---

[Back to the README](https://github.com/markup-carve/carve-js/blob/main/README.md)
