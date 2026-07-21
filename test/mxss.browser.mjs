// Browser-in-the-loop mutation-XSS check for the `img` SVG fence output.
//
// The string corpus (test/svg-sanitize-payloads.test.ts) proves the sanitizer
// OUTPUT contains no active markup. This goes further: it inserts that output
// into a REAL browser DOM the way a host renders it, so the browser RE-PARSES
// it — where mutation-XSS lives. Three insertion paths are exercised, because
// they execute DIFFERENT vector classes:
//
//   • inline   — host does `element.innerHTML = svg` (HTML-context reparse).
//                Fires `<img onerror>`, `<foreignObject>` HTML, video/audio.
//   • svgdoc   — `DOMParser().parseFromString(svg, 'image/svg+xml')` + import
//                (SVG-document context). Fires `<script>`, svg `<image onerror>`.
//   • sandbox  — `<img src="data:image/svg+xml,…">`. The browser sandboxes it;
//                this must be inert regardless (baseline).
//
// Detection is dialog-based (a fired alert/confirm/prompt raises a real dialog)
// plus any fetch to the flagged `evil.example` host. A `--selfcheck` run feeds
// RAW (unsanitized) payloads first and asserts the harness ACTUALLY detects them
// in the relevant path — a security test that cannot fail is worthless.
//
// Run: `npm run build && node test/mxss.browser.mjs` (needs `npx playwright
// install chromium`). Exits non-zero on any fired vector.
//
// Scope note: covers the innerHTML and DOMParser insertion paths, the realistic
// ways a host renders inline SVG. A host using another mechanism should re-verify.

import { chromium } from 'playwright'
import { sanitizeSvg } from '../dist/index.js'

const PAYLOADS = [
  '<svg onload="alert(1)"><rect/></svg>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><script href="data:,alert(1)"/></svg>',
  '<svg><rect onclick="alert(1)" onload="alert(1)" width="1" height="1"/></svg>',
  '<svg><rect fill=a onload=alert(1) width=1 height=1></rect></svg>',
  '<svg><image href="q" onerror="alert(1)" width="1" height="1"/></svg>',
  '<svg><image xlink:href="q" onerror="alert(1)" width="1" height="1"/></svg>',
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<svg><a href="jav&#x61;script:alert(1)"><rect width="1" height="1"/></a></svg>',
  '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
  '<svg><animate attributeName="href" values="#a;https://evil.example/x#b"/></svg>',
  '<svg><foreignObject><img src=q onerror=alert(1)></foreignObject></svg>',
  '<svg><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject></svg>',
  '<svg><use href="https://evil.example/x.svg#a"/></svg>',
  '<svg><image href="https://evil.example/x.png" width="1" height="1"/></svg>',
  '<svg><rect fill="url(https://evil.example/p.svg#x)" width="1" height="1"/></svg>',
  "<svg><style>@import url('https://evil.example/x.css');</style><rect/></svg>",
  '<svg><rect style="background:url(javascript:alert(1))" width="1" height="1"/></svg>',
  '<svg><title><style><img src=q onerror=alert(1)></style></title><rect width="1" height="1"/></svg>',
  '<svg><![CDATA[]><svg onload=alert(1)>]]><rect width="1" height="1"/></svg>',
  '<svg><!--<script>alert(1)</script>--><rect width="1" height="1"/></svg>',
  '<svg><desc><![CDATA[</desc><script>alert(1)</script>]]></desc><rect width="1" height="1"/></svg>',
]

const OPTS = { allowStyle: true, allowLinks: true, allowAnimation: true }
const SETTLE_MS = 300

const browser = await chromium.launch()
const page = await browser.newPage()
let dialogs = []
let netHits = []
page.on('dialog', (d) => { dialogs.push(`${d.type()}:${d.message()}`); d.dismiss().catch(() => {}) })
page.on('request', (r) => { if (/evil\.example/.test(r.url())) netHits.push(r.url()) })
await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>')

async function fires(markup, mode) {
  dialogs = []
  netHits = []
  await page.evaluate(
    async ({ m, mode }) => {
      const host = document.getElementById('host')
      host.innerHTML = ''
      if (mode === 'inline') {
        host.innerHTML = m
      } else if (mode === 'sandbox') {
        const img = document.createElement('img')
        img.src = m
        host.appendChild(img)
      } else if (mode === 'svgdoc') {
        try {
          const doc = new DOMParser().parseFromString(m, 'image/svg+xml')
          if (doc.documentElement && doc.documentElement.nodeName.toLowerCase() !== 'parsererror') {
            host.appendChild(document.importNode(doc.documentElement, true))
          }
        } catch {}
      }
    },
    { m: markup, mode },
  )
  await page.waitForTimeout(SETTLE_MS)
  await page.evaluate(() => { document.getElementById('host').innerHTML = '' })
  return [...dialogs, ...netHits]
}

if (process.argv.includes('--selfcheck')) {
  // Each RAW payload paired with the insertion mode it is known to execute in.
  // If the harness fails to detect these, its detection is broken.
  const raw = [
    ['<img src=q onerror=alert(1)>', 'inline'],
    ['<svg><foreignObject><img src=q onerror=alert(1)></foreignObject></svg>', 'inline'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'svgdoc'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><image href="q" onerror="alert(1)"/></svg>', 'svgdoc'],
  ]
  let caught = 0
  for (const [p, mode] of raw) {
    const hits = await fires(p, mode)
    console.log(`${hits.length ? 'DETECTED' : 'MISSED  '} [${mode}]  ${p}`)
    if (hits.length) caught++
  }
  await browser.close()
  if (caught !== raw.length) {
    console.error(`\nSELF-CHECK FAILED: harness caught only ${caught}/${raw.length} raw XSS — detection is broken.`)
    process.exit(2)
  }
  console.log(`\nself-check OK: harness detected ${caught}/${raw.length} raw XSS payloads across insertion modes.`)
  process.exit(0)
}

const failures = []
for (const payload of PAYLOADS) {
  const { svg, ok } = sanitizeSvg(payload, OPTS)
  if (!ok) continue // rejected → caller shows source, nothing rendered
  for (const mode of ['inline', 'svgdoc', 'sandbox']) {
    const input = mode === 'sandbox' ? `data:image/svg+xml,${encodeURIComponent(svg)}` : svg
    const hits = await fires(input, mode)
    if (hits.length) failures.push({ mode, payload, hits })
  }
}
await browser.close()

if (failures.length) {
  console.error(`\nmXSS FAIL — ${failures.length} vector(s) fired:\n`)
  for (const f of failures) console.error(`  [${f.mode}] ${f.hits.join(', ')}  <-  ${f.payload}`)
  process.exit(1)
}
console.log(`mXSS OK — ${PAYLOADS.length} sanitized payloads inert across inline + svgdoc + sandbox insertion, no dialog, no external fetch.`)
