import { describe, expect, it } from 'vitest'

import { sanitizeSvg, type SanitizeSvgOptions } from '../src/svg-sanitize.js'

/**
 * A curated corpus of known SVG-based XSS / resource-fetch vectors, drawn from
 * the PortSwigger XSS SVG cheatsheet, cure53 mXSS research, and the OWASP SVG
 * payloads. Each is fed through `sanitizeSvg` and the OUTPUT is asserted inert:
 * no active markup, event handlers, dangerous schemes, or external references
 * survive. Run under both default and maximally-permissive opts, since the opt
 * flags widen the allowlist and must not open a hole.
 *
 * This is a string-level guard (fast, dependency-free, CI-default). The
 * browser-in-the-loop mutation-XSS check lives in test/mxss.browser.test.ts.
 */

const PAYLOADS: string[] = [
  // -- script / event handlers --
  '<svg onload="alert(1)"><rect/></svg>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><script href="data:,alert(1)"/></svg>',
  '<svg><script xlink:href="data:,alert(1)"/></svg>',
  '<svg><rect onclick="alert(1)" onmouseover="alert(1)" width="1" height="1"/></svg>',
  '<svg><rect fill=a onload=alert(1) width=1 height=1></rect></svg>',
  '<svg><g onfocus="alert(1)" tabindex="1"><rect/></g></svg>',
  // -- javascript: / dangerous schemes on links --
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<svg><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>',
  '<svg><a href="ms-msdt:x"><rect width="1" height="1"/></a></svg>',
  '<svg><a href="vbscript:msgbox(1)"><rect width="1" height="1"/></a></svg>',
  // -- entity / escape obfuscated schemes --
  '<svg><a href="jav&#x61;script:alert(1)"><rect width="1" height="1"/></a></svg>',
  '<svg><a href="javascript&colon;alert(1)"><rect width="1" height="1"/></a></svg>',
  '<svg><a href="&#106;avascript:alert(1)"><rect width="1" height="1"/></a></svg>',
  // -- SMIL animation retargeting --
  '<svg><a id="x"><rect width="1" height="1"/></a><animate xlink:href="#x" attributeName="href" values="javascript:alert(1)"/></svg>',
  '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
  '<svg><animate attributeName="href" values="#a;https://evil.example/x#b"/></svg>',
  '<svg><animate attributeName="href" values="#a;//evil.example/x#b"/></svg>',
  '<svg><discard begin="0s" href="javascript:alert(1)"/></svg>',
  // -- foreignObject / embedded HTML --
  '<svg><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject></svg>',
  '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>',
  '<svg><foreignObject><body onload="alert(1)"/></foreignObject></svg>',
  // -- external resource fetches --
  '<svg><use href="https://evil.example/x.svg#a"/></svg>',
  '<svg><use xlink:href="//evil.example/x.svg#a"/></svg>',
  '<svg><image href="https://evil.example/x.png" width="1" height="1"/></svg>',
  '<svg><feImage href="https://evil.example/x.png"/></svg>',
  '<svg><rect fill="url(https://evil.example/p.svg#x)" width="1" height="1"/></svg>',
  '<svg><rect filter="url(https://evil.example/f.svg#x)" width="1" height="1"/></svg>',
  "<svg><rect fill='url(\"https://evil.example/a)b.svg#x\")' width='1' height='1'/></svg>",
  '<svg><rect clip-path="url(//evil.example/c)" width="1" height="1"/></svg>',
  // -- style element / attribute --
  "<svg><style>@import url('https://evil.example/x.css');</style><rect/></svg>",
  '<svg><style>* { background: url(javascript:alert(1)) }</style><rect/></svg>',
  '<svg><rect style="background:url(javascript:alert(1))" width="1" height="1"/></svg>',
  '<svg><rect style="fill:u\\72l(https://evil.example/x)" width="1" height="1"/></svg>',
  // -- handler / listener elements --
  '<svg><handler xmlns:ev="http://www.w3.org/2001/xml-events" ev:event="load">alert(1)</handler></svg>',
  '<svg><listener event="load" handler="#h"/><rect/></svg>',
  // -- comments / CDATA / PI / doctype tricks --
  '<svg><!--<script>alert(1)</script>--><rect width="1" height="1"/></svg>',
  '<svg><![CDATA[<script>alert(1)</script>]]><rect width="1" height="1"/></svg>',
  '<?xml-stylesheet type="text/xsl" href="javascript:alert(1)"?><svg><rect/></svg>',
  '<!DOCTYPE svg [<!ENTITY x "y">]><svg><rect width="1" height="1"/></svg>',
  // -- mutation-ish reparse candidates --
  '<svg><title><style><img src=1 onerror=alert(1)></style></title><rect width="1" height="1"/></svg>',
  '<svg><desc><![CDATA[</desc><script>alert(1)</script>]]></desc><rect width="1" height="1"/></svg>',
  '<svg><![CDATA[]><svg onload=alert(1)>]]><rect width="1" height="1"/></svg>',
]

// The XSS-relevant capability flags, all on. None of these must open a hole for
// the payloads above. `allowExternalImages` is deliberately excluded: it exists
// precisely to permit an external `<image href>` fetch, so it is a documented
// privacy opt, not an inertness guarantee — the default-opts run above asserts
// external images are blocked by default.
const ALL_ON: SanitizeSvgOptions = {
  allowStyle: true,
  allowLinks: true,
  allowAnimation: true,
}

// Assert the sanitized output carries nothing executable or externally-fetching.
function assertInert(rawOut: string) {
  // The forced canonical xmlns (`http://www.w3.org/2000/svg`) and the xlink
  // namespace decl legitimately contain a w3.org http URL that is NOT a fetch;
  // strip namespace declarations before the external-URL scan.
  const out = rawOut.replace(/\bxmlns(:[\w-]+)?\s*=\s*"[^"]*"/gi, '')
  expect(out).not.toMatch(/<script[\s/>]/i)
  expect(out).not.toMatch(/<foreignObject/i)
  expect(out).not.toMatch(/<handler\b/i)
  expect(out).not.toMatch(/<iframe/i)
  // no event-handler attributes (on… =)
  expect(out).not.toMatch(/\son[a-z]+\s*=/i)
  // no dangerous URL schemes anywhere in the output
  expect(out).not.toMatch(/javascript:/i)
  expect(out).not.toMatch(/vbscript:/i)
  expect(out).not.toMatch(/ms-msdt:/i)
  // no external absolute or protocol-relative references
  expect(out).not.toMatch(/https?:\/\//i)
  expect(out).not.toMatch(/url\(\s*['"]?\s*\/\//i)
  expect(out).not.toContain('evil.example')
  // no active CSS constructs
  expect(out).not.toMatch(/@import/i)
  expect(out).not.toMatch(/url\(\s*['"]?\s*(?!#)/i)
}

describe('sanitizeSvg — known-payload corpus (default opts)', () => {
  for (const [i, p] of PAYLOADS.entries()) {
    it(`payload #${i} is inert`, () => {
      const { svg, ok } = sanitizeSvg(p)
      // Either it was rejected (ok:false → caller shows source), or the emitted
      // SVG is inert. A rejected payload emits no svg string.
      if (ok) assertInert(svg)
      else expect(svg).toBe('')
    })
  }
})

describe('sanitizeSvg — known-payload corpus (all capabilities on)', () => {
  for (const [i, p] of PAYLOADS.entries()) {
    it(`payload #${i} is inert with every opt enabled`, () => {
      const { svg, ok } = sanitizeSvg(p, ALL_ON)
      if (ok) assertInert(svg)
      else expect(svg).toBe('')
    })
  }
})

describe('sanitizeSvg — idempotent + inert on double pass', () => {
  for (const [i, p] of PAYLOADS.entries()) {
    it(`payload #${i} stays inert after re-sanitizing`, () => {
      const once = sanitizeSvg(p, ALL_ON)
      if (!once.ok) return
      const twice = sanitizeSvg(once.svg, ALL_ON)
      expect(twice.svg).toBe(once.svg) // idempotent
      assertInert(twice.svg)
    })
  }
})
