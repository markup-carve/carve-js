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

The draft currently emits one complete chunk after acceptance. Borrowed events,
multi-chunk delivery, Web Streams, and WASM adapters remain follow-up work.
