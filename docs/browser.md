# Using carve-js in a browser


For consumers that load classic scripts rather than ESM - CDN script tags,
sandboxed iframes, userscript hosts - the package ships the same public API as
a minified IIFE bundle exposing a `carve` global. The `unpkg` and `jsdelivr`
fields point at it, so the bare package URL resolves there:

```html
<script src="https://unpkg.com/@markup-carve/carve/dist/carve.iife.min.js"></script>
<script>
  document.body.innerHTML = carve.carveToHtml('# Hello\n\nThis is /italic/ and *bold*.')
</script>
```

The bundle carries no Node builtins (the CLI is a separate entry) and does not
embed `@djot/djot`, which stays dependency-injected as in the ESM build. Every
name `@markup-carve/carve` exports is a property of the global, and CI asserts
that: the bundle is built and rendered against the ESM build over the whole
spec corpus on each pull request, so the published artifact is the library and
not an approximation of it.

The bundle is built at release time and is not present in a git-dependency
install of this repository; build it locally with `npm run build:browser`.

---

[Back to the README](https://github.com/markup-carve/carve-js/blob/main/README.md)
