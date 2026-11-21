# Standard extensions: navigation

`@markup-carve/carve/extensions` holds the standard extensions of Carve 0.2. They are provisional and may change in
0.2.x (`spec/0.2/extensions.md`). The core entry loads none of them: a host registers each one in the `extensions`
option of `render` or `renderWithDiagnostics`, and adds `tocRenderers` to `renderers` where a table of contents needs
its `<nav>`.

## Navigation

These extensions work on the render view as document transforms (C2-X-053 to C2-X-055). Each one is a factory that
returns an `ExtensionDefinition` with a `documentTransform`; the transforms run in registration order on a copy of the
resolved document, so the authored tree, `parse` and the Carve writer never see them.

```ts
import { render } from '@markup-carve/carve'
import { headingNumbers, headingPermalinks, tableOfContents, tocRenderers } from '@markup-carve/carve/extensions'

const html = render('= Intro\n\n== Usage\n\nSee </#Usage>.\n', {
  extensions: [headingNumbers(), headingPermalinks(), tableOfContents()],
  renderers: tocRenderers,
})
if (!html.startsWith('<nav class="toc" aria-label="Table of contents">')) throw new Error(html)
if (!html.includes('<a href="#Usage">Section 1.1 - Usage</a>')) throw new Error(html)
```

| Extension | What it does | Options |
|---|---|---|
| `tableOfContents()` | Inserts a `carve.toc` node with nested links to the top-level headings, at the top or bottom | `minLevel`, `maxLevel`, `listType` (`ul`, `ol`), `cssClass`, `position` (`top`, `bottom`), `collapsible`, `summary`, `open` |
| `tocPlacement()` | Writes a table of contents at each `::: toc` directive, from the headings at any depth | `{depth=N}` or `{from=X to=Y}` on the directive |
| `headingPermalinks()` | Appends a link to its own id to each heading | `symbol`, `cssClass`, `ariaLabel`, `levels`, `prepend`, `showOnHover`, `copyToClipboard` |
| `headingNumbers()` | Numbers the sections in a `<span class="section-number">` and writes `</#id>` as "Section 1.2 - Title" | `minLevel`, `label`, `crossref` (`number`, `number-title`, `title`) |
| `headingReference()` | Gives a class to each reference link that a heading resolves, such as `[Setup][]` | `cssClass` (default `heading-ref`) |
| `externalLinks()` | Sets `target` and `rel` on links to `http` and `https` URLs | `target` (`''` removes it), `rel`, `nofollow` |
| `linkPolicy()` | Writes a link, autolink or image whose URL the policy refuses as its text, and adds `rel` to the others | `allowedSchemes`, `deniedSchemes`, `allowedDomains`, `deniedDomains`, `allowExternal`, `allowInternal`, `rel`, `baseHost` |
| `autolink()` | Links bare URLs and email addresses in text | `allowedSchemes` (default `https`, `http`, `mailto`) |

The core render option `headingShift` (C2-H-208) shifts the headings before the first of these transforms runs, so
`minLevel`, `maxLevel` and `levels` name the shifted levels: with `headingShift: 1`, `headingPermalinks({ levels: [1] })`
matches no heading. The 0.1 `headingLevelShift()` extension is gone; use the option.

Without `tocRenderers`, a table of contents writes its fallback, the same list in a `<div>`, and the render reports
`extension-fallback-rendered`. Without `tocPlacement()`, a `::: toc` directive stays the core `<div class="toc">`.
Both renderers write the same HTML in `static` mode, since it holds no script.

A transform that changes heading text, such as `headingNumbers()` or `headingPermalinks()`, keeps each heading's id and
the targets of references to it. Text it inserts is left out of the derived text of a table of contents and of a
numbered cross-reference.

`linkPolicy()` narrows the core `urlPolicy` option and never widens it: a URL the core refuses stays refused.

### Changes from 0.1

- The 0.1 `[[Heading]]` and `[[Heading|text]]` forms are gone, because 0.2 adds no delimiter for an extension
  (C2-X-013). The core writes them `[Heading][]` and `[text][Heading]` (C2-H-083), and `headingReference()` keeps
  only the class. Where two headings share the text, the first one wins, as in the core.
- `tableOfContents({ position: 'bottom' })` puts the table inside the last section, because a 0.2 section holds every
  block after its heading.
- A registered `linkPolicy()` replaces the 0.1 `Profile.setLinkPolicy`; `baseHost` replaces the `profileBaseHost`
  option.
