# Carve 0.2 AST schema gaps

These cases were found with `carve/scripts/spec2-ast-crosscheck.mjs` at `next2`. The schema checkout is read only.

## Reference use still requires `form`

The `link` and `image` definitions list `refForm`, but their `dependentRequired` clauses still require the retired `form` key. C2-A-050 and C2-A-105 require `refForm`; C2-A-162 permits the resolved destination to be present. Both mutants are valid trees that the schema rejects:

```json
{"type":"document","astVersion":"2.0","children":[{"type":"paragraph","children":[{"type":"link","key":"a","namespace":"link","refForm":"full","children":[]}] }]}
{"type":"document","astVersion":"2.0","children":[{"type":"paragraph","children":[{"type":"image","key":"a","namespace":"link","refForm":"full","alt":"a"}]}]}
```

## Unqualified inline extension starting with underscore

C2-I-094 permits an underscore as the first character of an inline extension name. The `inline_extension.name` pattern in the AST schema requires a letter. This source-produced mutant is rejected by the schema:

```json
{"type":"document","astVersion":"2.0","children":[{"type":"paragraph","children":[{"type":"inline_extension","name":"_","children":[]}]}]}
```

## Out-of-shape include range retained for expansion

C2-B-205 defines a well-formed range, but C2-B-206 and `data/include-options.json` say an out-of-shape `lines` range leaves an include node for an expansion to report. The schema requires the range pattern and rejects this source-produced mutant:

```json
{"type":"document","astVersion":"2.0","children":[{"type":"include","path":"a.crv","options":{"lines":"0-2"}}]}
```
