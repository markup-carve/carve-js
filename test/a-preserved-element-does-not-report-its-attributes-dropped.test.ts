/*
 * WHAT THE OUTPUT KEEPS IS NOT A LOSS (markup-carve/carve-js#1468).
 *
 * `roundtrip` hands some elements back verbatim as raw HTML. `block()` reads
 * their attributes on the way past, long before any arm decides that, so every
 * attribute the policy refuses was reported `attribute-dropped` - while the
 * preserved bytes carried it into the output. The report made a FALSE claim,
 * and it made it about the one attribute a consumer of this mode would act on:
 * `roundtrip` is documented as unsafe for untrusted input, so a live `onclick`
 * in the output is the row that matters.
 *
 * ROLLING THE ROWS BACK WOULD HAVE BEEN THE SAME DEFECT POINTED THE OTHER WAY.
 * It trades a false statement for a missing security-relevant fact, silently.
 * So the rows stay and stop claiming a drop: `attribute-preserved` says the
 * element was kept WITH the attribute on it, and it is a code of its own
 * because a consumer that filters on `attribute-dropped` rather than reading
 * the prose would still be told a drop happened.
 *
 * SEVERITY IS NOT COPIED FROM THE DROP. A dropped handler is a `warning`; a
 * SURVIVING one, in a mode not safe for untrusted input, is a stronger signal
 * and not a weaker one, so it is `error` - the only level left that separates
 * the two for a filter. An attribute refused for a reason that is not safety
 * rides along harmlessly and is `info`.
 *
 * Every assertion below reads the CODES. The prose is checked too, but the code
 * is what carries the meaning, so a test that only pinned messages would pass
 * on a report that still said `attribute-dropped`.
 */
import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

const roundtrip = { mode: 'roundtrip' } as const

describe('a preserved element does not report its attributes dropped', () => {
  it('says the event handler is in the output, and says it louder than a drop', () => {
    const result = htmlToCarve('<form onclick="x()" id="q"><p>a</p></form>', roundtrip)
    expect(result.value).toContain('onclick="x()"')
    expect(result.report.diagnostics.map((entry) => entry.code)).toEqual(['attribute-preserved', 'raw-preserved'])
    expect(result.report.diagnostics[0]).toMatchObject({
      code: 'attribute-preserved',
      severity: 'error',
      message: 'Preserved event-handler attribute onclick on <form> in the raw HTML this element is kept as',
    })
  })

  it('reaches the reasons that are not safety, at their own severity', () => {
    // A plain attribute with a name Carve cannot spell, and one whose value
    // spans a line break: refused for shape rather than for safety, kept by
    // the preserved bytes all the same, and no louder than `info` for it.
    const result = htmlToCarve('<form 5x="1" title="a\nb"><p>a</p></form>', roundtrip)
    expect(result.value).toContain('5x="1"')
    expect(result.report.diagnostics.map((entry) => entry.code)).toEqual([
      'attribute-preserved',
      'attribute-preserved',
      'raw-preserved',
    ])
    expect(result.report.diagnostics.map((entry) => entry.severity)).toEqual(['info', 'info', 'warning'])
    expect(result.report.diagnostics[0]!.message).toBe(
      'Preserved unsupported attribute 5x on <form> in the raw HTML this element is kept as: not spellable as a Carve attribute name',
    )
  })

  it('separates the safety reasons from the shape reasons on one element', () => {
    // THE GENERAL CASE, and the reason one `onclick` on one `<form>` is not a
    // test: several refused attributes at once, of both kinds, plus `id` -
    // which is kept as a Carve attribute in every other mode, is refused by no
    // rule at all, and therefore takes no row here either.
    const result = htmlToCarve(
      '<fieldset id="f" onmouseover="y()" 9bad="1" onfocus="z()" data-k="v"><p>a</p></fieldset>',
      roundtrip,
    )
    for (const attribute of ['id="f"', 'onmouseover="y()"', '9bad="1"', 'onfocus="z()"', 'data-k="v"']) {
      expect(result.value).toContain(attribute)
    }
    expect(result.report.diagnostics.map((entry) => [entry.code, entry.severity])).toEqual([
      ['attribute-preserved', 'error'],
      ['attribute-preserved', 'info'],
      ['attribute-preserved', 'error'],
      ['raw-preserved', 'warning'],
    ])
    expect(result.report.diagnostics.map((entry) => entry.message)).toEqual([
      'Preserved event-handler attribute onmouseover on <fieldset> in the raw HTML this element is kept as',
      'Preserved unsupported attribute 9bad on <fieldset> in the raw HTML this element is kept as: not spellable as a Carve attribute name',
      'Preserved event-handler attribute onfocus on <fieldset> in the raw HTML this element is kept as',
      'Preserved unsupported <fieldset> element as raw HTML',
    ])
  })

  it('answers the same way from the inline preserve arm', () => {
    // A different arm of the same mode, and the one that reports an
    // injection sink rather than an event handler. `<iframe srcdoc>` is not an
    // `on*` name and is refused by the same renderer filter, so it is the same
    // fact and takes the same severity.
    const result = htmlToCarve('<iframe srcdoc="<p>x</p>" onload="z()"></iframe>', roundtrip)
    expect(result.value).toContain('srcdoc=')
    expect(result.report.diagnostics.map((entry) => [entry.code, entry.severity])).toEqual([
      ['attribute-preserved', 'error'],
      ['attribute-preserved', 'error'],
      ['raw-preserved', 'warning'],
    ])
    expect(result.report.diagnostics[0]!.message).toBe(
      'Preserved injection-sink attribute srcdoc on <iframe> in the raw HTML this element is kept as',
    )
  })

  it('answers the same way from the figure preserve arm', () => {
    // markup-carve/carve#1704's arm, whose own rationale named this defect and
    // left the element's rows alone so no arm would disagree with its
    // neighbours while it was open. It agrees with them now.
    const result = htmlToCarve(
      '<figure onclick="c()" id="g"><ul><li>a</li></ul><figcaption>Cap</figcaption></figure>',
      roundtrip,
    )
    expect(result.value).toContain('onclick="c()"')
    expect(result.report.diagnostics.map((entry) => [entry.code, entry.severity])).toEqual([
      ['attribute-preserved', 'error'],
      ['raw-preserved', 'warning'],
    ])
  })

  it('still reports a drop where the element is not preserved', () => {
    // THE OTHER HALF, and what keeps the change from being a blanket rename.
    // The same `<form onclick>` outside `roundtrip` really does lose the
    // handler, so the row that says so has to survive untouched.
    const result = htmlToCarve('<form onclick="x()" id="q"><p>a</p></form>', { mode: 'semantic' })
    expect(result.value).not.toContain('onclick')
    expect(result.report.diagnostics.map((entry) => [entry.code, entry.severity])).toEqual([
      ['attribute-dropped', 'warning'],
      ['element-unwrapped', 'info'],
      ['attribute-dropped', 'warning'],
    ])
    expect(result.report.diagnostics[0]!.message).toBe('Dropped event-handler attribute onclick on <form>')
  })

  it('rewrites the rows of the preserved element and of nothing else', () => {
    // THE REWRITE IS SCOPED TO THE ELEMENT THE ARM DECIDED ABOUT.
    // `preserveOwnAttributes` matches on the node rather than on the path, so
    // a paragraph that really does lose its handler goes on saying so while
    // its `<form>` neighbour says the opposite in the same report.
    const result = htmlToCarve('<p onclick="a()">x</p><form onclick="b()"><p>y</p></form>', roundtrip)
    expect(result.report.diagnostics.map((entry) => [entry.path, entry.code])).toEqual([
      ['/p[1]', 'attribute-dropped'],
      ['/form[2]', 'attribute-preserved'],
      ['/form[2]', 'raw-preserved'],
    ])
    expect(result.value).not.toMatch(/onclick="a\(\)"/)
    expect(result.value).toContain('onclick="b()"')
  })
})
