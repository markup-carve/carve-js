# Streaming render boundary

`tryRenderHtmlStreaming` tells a caller whether the borrowed renderer accepted
the whole document.

```ts
import { carveToHtml, tryRenderHtmlStreaming } from '@markup-carve/carve'

let html = ''
const outcome = tryRenderHtmlStreaming('# Title\n', {}, chunk => {
  html += chunk
})
if (outcome === 'needs-ast') html = carveToHtml('# Title\n')
```

On `needs-ast`, the sink has not been called, so fallback cannot duplicate or
leak partial output. That makes the fast-path hit rate measurable and gives
servers a safe integration point.

Accepted HTML is delivered in newline-terminated chunks, with any final
unterminated line delivered last. Concatenating the chunks reproduces the
renderer output exactly. Empty accepted output calls the sink once with an
empty string. Sink failures propagate to the caller.

The complete HTML string is buffered before the first callback. This API
measures acceptance and controls delivery; parsing and rendering still finish
before delivery starts. Borrowed events and unbuffered rendering remain future
work.
