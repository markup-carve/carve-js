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

Accepted HTML is delivered in chunks of at most 4096 characters. The accepted
subset uses ASCII input and output, so these are also UTF-8 byte bounds. Chunks
end at newlines where possible; long lines span multiple chunks. Concatenating
them reproduces the renderer output exactly. Empty accepted output calls the
sink once with an empty string. Sink failures propagate to the caller.

A validation pass discards output before any callback runs. A second pass writes
directly to the bounded output buffer, without assembling the complete HTML
string. Source line indexes and reference definitions still use memory
proportional to the input. Unsupported syntax or options return `needs-ast`.
URL scheme lists are copied before validation so callbacks cannot change them
between passes.
