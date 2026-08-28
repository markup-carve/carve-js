# Running it for people (CI, hooks, Prettier)


`carve fmt --check` and `carve lint` are only useful if they run without anyone
remembering to type them. Three integrations ship with this package, and all
three drive the same binary at the same version - so they cannot disagree about
what canonical form is.

## GitHub Action


```yaml
- uses: markup-carve/carve-js@v0.1.2
  with:
    files: 'docs/**/*.crv'   # default: **/*.crv
```

Runs `carve fmt --check` and `carve lint` over the matched documents. Both run
even when the first fails, so one push shows every problem rather than the
formatting one today and the lint one tomorrow. A repository with no Carve
documents yet passes rather than failing on an empty glob.

Inputs: `files`, `fmt`, `lint`, `from-djot`, `portable`, `version`.

## pre-commit


```yaml
repos:
  - repo: https://github.com/markup-carve/carve-js
    rev: v0.1.2
    hooks:
      - id: carve-fmt      # report; use carve-fmt-write to fix in place
      - id: carve-lint
```

`language: node` makes [pre-commit](https://pre-commit.com) install this package
at the pinned `rev`, so the hook and the Action run the same engine - which is
the only thing that makes pinning a rev worth anything.

## Prettier


```json
{ "plugins": ["@markup-carve/carve/prettier"] }
```

Prettier then formats `.crv` files, with no `overrides` block needed. The
plugin does not reimplement anything: it hands the source to the same formatter, so `prettier --write` and `carve fmt --write` produce
byte-identical output, down to the trailing newline.

Prettier's layout options are deliberately ignored. `printWidth`, `tabWidth` and
`useTabs` describe a formatter's freedom, and Carve's canonical form has none -
PART 11 of the grammar fixes it. Honoring `printWidth` here would produce output
that `carve fmt --check` then rejects.

---

[Back to the README](https://github.com/markup-carve/carve-js/blob/main/README.md)
