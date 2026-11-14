# Carve 0.2 specification gaps

Ranked by the cost of changing the contract after a freeze. The `carve` checkout was read only.

## 1. Reference link schema still requires a retired field

The `link` and `image` schemas use `dependentRequired` to require `form` beside `key` and `namespace`. C2-A-050 and C2-A-105 use `refForm` instead. The engine produces the specified `refForm` shape. In the CI-sized 100,000-mutant run of `spec2-ast-crosscheck.mjs`, this accounted for all 50 source-produced schema failures and 416 of 433 mutant disagreements. The raw script exits with failure; the repository's explanation gate accepts these known differences and reports zero unexplained disagreements. The engine cannot add the retired field without violating the tree contract.

```json
{"type":"document","astVersion":"2.0","children":[{"type":"paragraph","children":[{"type":"link","key":"a","namespace":"link","refForm":"full","children":[]}] }]}
```

## 2. Renderer output is an HTML string

C2-X-034 requires host escaping and URL policy. The public renderer receives host helpers for text, attributes, child lists and generated ids, and the shipped tabs renderer uses them. A third-party renderer can still return arbitrary HTML, which the host cannot reliably inspect and repair. Enforcing the rule for untrusted renderer code would require a structured output API.

## 3. Third-party slot traversal has no schema context

The generated slot table fixes traversal order for the standard tabs extension. A supplied node of another registered extension is traversed in the order of keys in its `slots` object, which can differ from its registration's slot declaration order under C2-X-020. The walker API would need the extension registry or a separate order record to make this independent of object key order.

## 4. Fallback nesting clauses overlap

C2-X-022 and C2-A-126 require qualified extension fallbacks to contain only core nodes. C2-X-030 separately sets a limit for nested extension nodes on a fallback path. The validator enforces core-only qualified fallbacks and still bounds the legacy unqualified inline extension fallback path to 32. The specification should say whether C2-X-030 applies only to that legacy path.

## 5. Annotation sidecar references need a paired reader API

C2-A-203 and C2-A-206 require checking annotation ids against a separate range sidecar. The tree reader accepts a tree alone, so it validates the `carve.annotation` value schema and duplicate ids but cannot prove that a range exists. A sidecar-aware reader or validator signature is needed to enforce those clauses.

## 6. Other pre-existing schema differences

The AST schema accepts a position with its start behind its end and an extension name without a declaration; the engine refuses both under C2-A-140 and C2-A-123. It does not encode the tree nesting bound. The schema rejects an unqualified inline extension whose name starts with underscore, although C2-I-094 permits it. It also rejects an out-of-shape include `lines` range retained for expansion under C2-B-206. These were already present before the extension work. The remaining 17 mutant disagreements in the CI-sized run fall into these categories.
