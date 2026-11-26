# Fenced renderers: diagrams, math, code groups and callouts

Provisional standard extensions from `@markup-carve/carve/extensions`. They follow the 0.2 extension interface
(`spec/0.2/extensions.md`) and may change in a 0.2.x release. The core entry never loads them: a host registers each
one it wants.

Each factory returns a bundle `{ extensions, renderers }`; `codeCallouts()` adds `transforms`. Spread a bundle into the
render options, or merge several with `withExtensions`:

```ts
import { render } from '@markup-carve/carve'
import { mathBlock, mermaid, withExtensions } from '@markup-carve/carve/extensions'

const { extensions, renderers } = withExtensions(mermaid(), mathBlock())
const html = render('```mermaid\ngraph TD; A-->B\n```\n', { extensions, renderers })
if (!html.startsWith('<pre class="mermaid"')) throw new Error(html)
```

A registered extension turns the claimed core node into an extension node whose fallback is that core node, so a
reader or renderer without the extension still shows the source (C2-X-022, C2-X-035). The Carve writer writes the
original fence or div back (C2-X-027).

## Diagram fences: `fencedRender` and its presets

`fencedRender(options)` claims fenced code blocks by language and writes one element for a client library to draw
on the page. The body is not parsed as Carve.

| Option | Default | Meaning |
| --- | --- | --- |
| `language` | required | the fence language word or words |
| `cssClass` | the first word | class of the element, ahead of the author's classes |
| `tag` | `div` in json mode, else `pre` | the element |
| `contentMode` | `text` | `text` escapes `&` and `<` and keeps `>`; `json` puts the body in `<script type="application/json">` |
| `wrapInFigure`, `figureClass` | off, `{cssClass}-figure` | wraps the element in a `<figure>` |
| `label` | the css class | accessible name written with `role="img"`; `''` writes neither |
| `build` | none | a host function from source to self-contained HTML for static mode |

The presets are `mermaid`, `d2`, `graphviz` (claims `dot` and `graphviz`), `wavedrom`, `abc`, `plantuml` (claims
`plantuml` and `puml`), `vegaLite` (json mode) and `chart` (json mode). `presets(builders)` registers all of them;
`builders` maps a preset's css class to its `build` function. Each fence word is the extension
`carve.fencedRender.<word>`, version `1`.

```ts
import { render } from '@markup-carve/carve'
import { presets } from '@markup-carve/carve/extensions'

const html = render('```dot\ndigraph { a -> b }\n```\n', presets())
if (html !== '<pre class="graphviz" role="img" aria-label="graphviz">digraph { a -> b }</pre>') throw new Error(html)
```

An author's `role`, `aria-label` or `aria-labelledby` on the fence wins over the generated ones.

In static mode (`mode: 'static'`) a preset writes the `build` output inside a `<div>` with the fence's attributes.
Without a `build` function no build-time renderer is registered, so static mode writes the fallback code block
(C2-X-052). The engine makes no network call: a diagram tool runs in the host.

## Display math: `mathBlock`

`mathBlock(options)` renders a `math` fence as `<div class="math display">\[…\]</div>`, the delimiters KaTeX and
MathJax read. `language` changes the fence word; `build(tex, display)` supplies MathML or HTML for static mode. The
extension is `carve.mathBlock`.

## Code groups: `codeGroup`

`codeGroup(options)` claims a `code-group` div whose body is one or more code blocks and nothing else; any other div
stays a core div. Each block becomes a panel, labeled by its bracket label, then its quoted title, then its language,
then `Code N`. The first block with a `selected` attribute is selected, otherwise the first block.

````carve
::: code-group
```js [npm]
npm install @markup-carve/carve
```

```sh [yarn]
yarn add @markup-carve/carve
```
:::
````

- `mode: 'css'` (default) writes radio inputs and labels and needs no script.
- `mode: 'aria'` writes `role="tab"` buttons and `role="tabpanel"` panels; a page script switches them.
- Static mode writes one `<section>` per panel headed by an `<h3>` label, with no controls and no generated ids.

The group is named by `groupLabel`, else the `codeGroup` entry of the `labels` option (`Code examples`). Classes and
the id prefix are options (`wrapperClass`, `panelClass`, `labelClass`, `radioClass`, `idPrefix`); `highlighter(code,
language)` replaces the HTML of each panel's code. The extension is `carve.codeGroup` with the slot `panels`.

## Code callouts: `codeCallouts`

A `<n>` at the end of a code line becomes a `<b class="callout">` bubble, and a paragraph right after the code
block whose every line starts with `<n> ` becomes `<ol class="callouts">`. Callouts apply to code blocks of every
language, so no fence matcher can claim them: `codeCallouts()` is a document transform (C2-X-053) and renders through
`renderWithDocumentTransforms`.

```ts
import { renderWithDocumentTransforms } from '@markup-carve/carve'
import { codeCallouts } from '@markup-carve/carve/extensions'

const { extensions, renderers, transforms } = codeCallouts()
const source = '```js\nlet a = 1 <1>\n```\n<1> The answer\n'
const { html } = renderWithDocumentTransforms(source, transforms ?? [], { extensions, renderers })
if (!html.includes('<ol class="callouts"><li value="1">The answer</li></ol>')) throw new Error(html)
```

The transform works on a copy of the resolved view; the parsed tree and the written Carve stay unchanged. Both modes
write the same HTML. The extensions are `carve.codeCallouts.code` and `carve.codeCallouts.list`.
