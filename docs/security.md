# Untrusted input


The always-on baseline needs no configuration: dangerous URL schemes are blanked
(`javascript:`, `data:`, and the rest of the spec's denylist), event-handler
attributes like `onclick` are dropped, and the bidi override/isolate characters
behind Trojan Source (U+202A-202E, U+2066-2069) are removed from rendered text -
while the legitimate LRM/RLM marks are kept. That much is normative, so every
implementation does it.

The one thing you must opt out of is raw passthrough. A ` ```=html ` block or
`` `…`{=html} `` span is emitted **verbatim** into the HTML output by design, so
anything you did not author needs:

``` js
import { carveToHtml, Profile } from '@markup-carve/carve'

const html = carveToHtml(userInput, {
  allowRawHtml: false,          // escape =html blocks/spans instead of emitting
  profile: Profile.comment(),   // full | article | comment | minimal
})
```

`allowRawHtml: false` is HTML-specific, because HTML is the only target that can
emit live markup - `--markdown` escapes raw HTML, `--plain` drops it, `--ansi`
and `--carve` keep it as text. A `Profile` restricts which constructs are allowed
at all, caps input length, and pairs with `LinkPolicy` for destinations; it is
accepted by every renderer except the formatter (`carveToCarve`), which
deliberately formats what the author wrote rather than the filtered result.

Same thing from the CLI:

```bash
carve --safe untrusted.crv                      # or --no-raw-html
carve --safe --profile comment untrusted.crv
```

Full recipe, defaults, the threat model and a checklist:
[Security](https://markup-carve.github.io/carve/security).

---

[Back to the README](https://github.com/markup-carve/carve-js/blob/main/README.md)
