/*
 * `style` reaches the report through the refusal policy every other attribute
 * goes through (markup-carve/carve#2267, clause `docs/html-import-contract.md`
 * under *A refused declaration in `style` is a refused attribute*, ticket
 * markup-carve/carve-js#2043).
 *
 * Inside an element `roundtrip` keeps whole, the CSS mapping never runs, so
 * `style-unmapped` there named a mapping that did not happen and a descendant's
 * `style` was reported not at all. The rows are asserted WHOLE - severity,
 * fidelity, confidence, path and message - because the code alone passed while
 * the descendant was silent, and the cross-engine gate in the spec repo
 * compares all six fields.
 */
import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'
import { renderedAttrValue } from '../src/render-html.js'

type Row = [string, string, string, string, string, string]

const report = (html: string, mode: 'roundtrip' | 'safe' | 'semantic' = 'roundtrip'): Row[] =>
  htmlToCarve(html, { mode }).report.diagnostics.map(
    (d) => [d.code, d.severity, d.fidelity, d.confidence, d.path!, d.message] as Row,
  )

const value = (html: string, mode: 'roundtrip' | 'safe' | 'semantic' = 'roundtrip') => htmlToCarve(html, { mode }).value

/** The ticket's payload: a refused declaration on the kept element AND on a descendant. */
const REPRO = '<form style="background:url(javascript:x)" onclick="y()"><p style="width:expression(alert(1))">a</p></form>'

describe('a refused declaration in style is a refused attribute', () => {
  it('reports both styles in the #2043 payload, each with its own reason', () => {
    expect(report(REPRO)).toEqual([
      [
        'attribute-preserved',
        'error',
        'preserved',
        'exact',
        '/form[1]',
        'Preserved style with a denied URL scheme in a declaration value on <form> in the raw HTML this element is kept as',
      ],
      [
        'attribute-preserved',
        'error',
        'preserved',
        'exact',
        '/form[1]',
        'Preserved event-handler attribute onclick on <form> in the raw HTML this element is kept as',
      ],
      ['raw-preserved', 'warning', 'degraded', 'exact', '/form[1]', 'Preserved unsupported <form> element as raw HTML'],
      [
        'attribute-preserved',
        'error',
        'preserved',
        'exact',
        '/form[1]/p[1]',
        'Preserved style with a construct the CSS sanitizer refuses on <p> inside the raw HTML <form> is kept as',
      ],
    ])
  })

  /* Nothing is removed: the ruling is about the report, not about the bytes. */
  it('keeps both declarations in the output', () => {
    expect(value(REPRO)).toContain('style="background:url(javascript:x)"')
    expect(value(REPRO)).toContain('style="width:expression(alert(1))"')
  })

  it('names no style-unmapped inside the kept bytes', () => {
    expect(report(REPRO).map((row) => row[0])).not.toContain('style-unmapped')
  })

  /*
   * CONTROL FOR THE CLASS BOUNDARY. Without it a change that marks every kept
   * `style` an error passes the test above.
   */
  it('reports a benign style in kept bytes at info', () => {
    expect(report('<form style="color:red"><a href="/ok" style="color:blue">t</a></form>')).toEqual([
      [
        'attribute-preserved',
        'info',
        'preserved',
        'exact',
        '/form[1]',
        'Preserved style on <form> in the raw HTML this element is kept as',
      ],
      ['raw-preserved', 'warning', 'degraded', 'exact', '/form[1]', 'Preserved unsupported <form> element as raw HTML'],
      [
        'attribute-preserved',
        'info',
        'preserved',
        'exact',
        '/form[1]/a[1]',
        'Preserved style on <a> inside the raw HTML <form> is kept as',
      ],
    ])
  })

  /*
   * CONTROL FOR THE ROUTING. Outside kept bytes the CSS mapping does run, so an
   * unmapped declaration is still `style-unmapped` in both modes that map CSS.
   */
  it.each(['roundtrip', 'semantic'] as const)('leaves a style outside kept bytes style-unmapped in %s', (mode) => {
    expect(report('<p style="color:red">x</p>', mode)).toEqual([
      ['style-unmapped', 'info', 'degraded', 'exact', '/p[1]', 'CSS declaration color was not mapped'],
    ])
    expect(value('<p style="color:red">x</p>', mode)).toBe('x\n')
  })

  /*
   * The reason comes from a closed set of two, so every value has to land in one
   * of three buckets. A `url(...)` with no denied scheme is the one that shows
   * the two error reasons are not the same test: the renderer blanks the value
   * for the construct, and no scheme in it is denied.
   */
  const DECLARATIONS: Array<[string, 'error' | 'info', string]> = [
    ['background:url(javascript:x)', 'error', 'style with a denied URL scheme in a declaration value'],
    ['background:url(vbscript:x)', 'error', 'style with a denied URL scheme in a declaration value'],
    ['width:expression(alert(1))', 'error', 'style with a construct the CSS sanitizer refuses'],
    ['background:url(pic.png)', 'error', 'style with a construct the CSS sanitizer refuses'],
    ['behavior:url(x.htc)', 'error', 'style with a construct the CSS sanitizer refuses'],
    ['color:red', 'info', 'style'],
    ['text-align:left', 'info', 'style'],
    // The sanitizer answers `''` for an empty value as well as for a blanked
    // one, so an empty `style` is the case that reads refused from the answer
    // alone. It is one row like any other `style` in the bytes.
    ['', 'info', 'style'],
    ['   ', 'info', 'style'],
    // BOTH READINGS OVER ONE TEXT (markup-carve/carve-js#2058). A scan of the raw
    // attribute answered `error` about a comment the renderer writes back
    // untouched, and gave the construct reason where the scheme reason is the
    // true one. Comments are gone and CSS escapes decoded before either reading.
    ['color:red;/*url(javascript:x)*/', 'info', 'style'],
    ['/*url(javascript:x)*/color:red', 'info', 'style'],
    ['background:url(pic.png)/*url(javascript:x)*/', 'error', 'style with a construct the CSS sanitizer refuses'],
    ['background:url(java\\73 cript:x)', 'error', 'style with a denied URL scheme in a declaration value'],
    ['background:\\75 rl(javascript:x)', 'error', 'style with a denied URL scheme in a declaration value'],
    ['background:u\\72 l(javascript:x)', 'error', 'style with a denied URL scheme in a declaration value'],
    // The same denied URL outside the comment keeps the scheme reason.
    ['/*a*/background:url(javascript:x)', 'error', 'style with a denied URL scheme in a declaration value'],
    // Neither escaping nor commenting adds a THIRD reason: carve#2267 closes the
    // set at two. An escaped `expression(` and a denied scheme with no `url(...)`
    // in the value both stay on the construct reason.
    ['width:\\65 xpression(alert(1))', 'error', 'style with a construct the CSS sanitizer refuses'],
    ['javascript:x', 'error', 'style with a construct the CSS sanitizer refuses'],
  ]

  it.each(DECLARATIONS)('reads %s as %s', (declaration, severity, subject) => {
    expect(report(`<form style="${declaration}">t</form>`)[0]).toEqual([
      'attribute-preserved',
      severity,
      'preserved',
      'exact',
      '/form[1]',
      `Preserved ${subject} on <form> in the raw HTML this element is kept as`,
    ])
  })

  /*
   * The class as a BICONDITIONAL against the sanitizer rather than an imitation
   * of it: the row is `error` exactly where the renderer blanks the value. A
   * raw-byte scan cannot satisfy it, because a denied URL inside a CSS comment
   * reports `error` about a value the renderer writes back as authored.
   */
  it.each(DECLARATIONS)('marks %s error exactly where the renderer blanks it', (declaration) => {
    const blanked = renderedAttrValue('style', declaration) !== declaration
    expect(report(`<form style="${declaration}">t</form>`)[0]![1] === 'error').toBe(blanked)
  })

  /* The bytes still reach the output as authored, comment and escape included. */
  it('keeps a commented or escaped declaration in the output', () => {
    for (const declaration of ['color:red;/*url(javascript:x)*/', 'background:url(java\\73 cript:x)']) {
      expect(value(`<form style="${declaration}">t</form>`)).toContain(`style="${declaration}"`)
    }
  })

  /* The inline arm keeps a raw SPAN through its own walk. */
  it('reports a style in the bytes of a raw-kept span', () => {
    expect(report('<p>a <output style="color:red"><b style="width:expression(1)">t</b></output> b</p>')).toEqual([
      [
        'attribute-preserved',
        'info',
        'preserved',
        'exact',
        '/p[1]/output[2]',
        'Preserved style on <output> in the raw HTML this element is kept as',
      ],
      [
        'raw-preserved',
        'warning',
        'degraded',
        'exact',
        '/p[1]/output[2]',
        'Preserved unsupported <output> element as raw HTML',
      ],
      [
        'attribute-preserved',
        'error',
        'preserved',
        'exact',
        '/p[1]/output[2]/b[1]',
        'Preserved style with a construct the CSS sanitizer refuses on <b> inside the raw HTML <output> is kept as',
      ],
    ])
  })

  /*
   * A `style` row is ordered like any other refusal: by the position the element
   * spells the attribute at, not by the class the importer put it in.
   */
  it('orders the style row where the element spells the attribute', () => {
    const messages = (html: string) => report(html).slice(0, 2).map((row) => row[5])
    expect(messages('<form style="color:red" onclick="a()">t</form>')).toEqual([
      'Preserved style on <form> in the raw HTML this element is kept as',
      'Preserved event-handler attribute onclick on <form> in the raw HTML this element is kept as',
    ])
    expect(messages('<form onclick="a()" style="color:red">t</form>')).toEqual([
      'Preserved event-handler attribute onclick on <form> in the raw HTML this element is kept as',
      'Preserved style on <form> in the raw HTML this element is kept as',
    ])
  })

  /*
   * `safe` and `semantic` UNWRAP the form instead of keeping it, so no bytes are
   * kept and the CSS mapping is the only reading - the state the routing must
   * not reach outside the exemption.
   */
  it.each(['safe', 'semantic'] as const)('leaves %s reporting the unmapped declaration', (mode) => {
    const rows = report(REPRO, mode)
    expect(rows.filter((row) => row[0] === 'attribute-preserved')).toEqual([])
    expect(rows.filter((row) => row[0] === 'style-unmapped').map((row) => row[4])).toEqual(['/form[1]', '/form[1]/p[1]'])
    expect(value(REPRO, mode)).not.toContain('expression(')
  })
})
