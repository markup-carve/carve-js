import { describe, it, expect } from 'vitest'
import {
  carveToHtml,
  carveToMarkdown,
  carveToPlainText,
  carveToAnsi,
  lintCarve,
  fromAstJson,
  renderHtml,
  AstJsonUnknownNodeTypeError,
} from '../src/index.js'
import { sanitizeSvg } from '../src/svg-sanitize.js'

/**
 * Every lookup table keyed by AUTHOR TEXT is a plain object, so it inherits
 * from `Object.prototype` and answers for keys no document ever put there.
 *
 * `[^__proto__]` - twelve bytes, the default `carveToHtml` path, no options -
 * passed the "is there a definition for this label" guard because
 * `defs['__proto__']` is `Object.prototype` and truthy, then threw an uncaught
 * `TypeError` out of the `for...of` over the body that was not there
 * (markup-carve/carve-js#886). The same read shape appears in the AST-JSON
 * schema tables, the AST-JSON definition adoption, the extension renderer
 * records, the `symbols` option, the profile supertype table and the SVG
 * sanitizer's entity table, each with its own symptom - a crash, a dropped
 * diagnostic, a silently discarded definition, garbage output.
 *
 * carve-php and carve-rs have no such class: PHP arrays and Rust `HashMap`s
 * have no prototype chain to walk into.
 *
 * Every case below is stated for the WHOLE key set rather than for
 * `__proto__` alone, because `__proto__` behaves differently from the rest
 * (it is an accessor, they are plain inherited values) and a fix that handles
 * only one of the two shapes passes half of them.
 */
const PROTOTYPE_KEYS = [
  '__proto__',
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
] as const

describe('a footnote label that names a prototype key', () => {
  for (const key of PROTOTYPE_KEYS) {
    it(`renders [^${key}] as literal text on every target`, () => {
      const src = `[^${key}]`

      // An UNRESOLVED reference renders as the literal source it came from,
      // which is what a missing definition has always meant. The Markdown
      // target escapes the brackets so its own reader does not re-read them as
      // a reference, so each target is checked against what it writes for an
      // ordinary undefined label.
      expect(carveToHtml(src)).toBe(carveToHtml('[^nosuch]').replace('nosuch', key))
      expect(carveToMarkdown(src)).toBe(carveToMarkdown('[^nosuch]').replace('nosuch', key))
      expect(carveToPlainText(src)).toBe(carveToPlainText('[^nosuch]').replace('nosuch', key))
      expect(carveToAnsi(src)).toBe(carveToAnsi('[^nosuch]').replace('nosuch', key))
    })

    it(`resolves a real definition labelled ${key}`, () => {
      // The other half: the guard must not turn into a blanket refusal. A
      // definition the author actually wrote still resolves and still numbers.
      const html = carveToHtml(`x[^${key}]\n\n[^${key}]: the body\n`)

      expect(html).toContain('doc-noteref')
      expect(html).toContain('the body')
      expect(html).not.toContain(`[^${key}]`)
    })

    it(`reports [^${key}] as an unresolved footnote`, () => {
      // `carve lint` asked the same truthy question and got the same wrong
      // answer, so it stayed silent about a reference that renders as text.
      const rules = lintCarve(`[^${key}]\n`).map((d) => d.rule)

      expect(rules).toContain('unresolved-footnote')
    })
  }

  it('reports an ordinary unresolved footnote the same way (control)', () => {
    expect(lintCarve('[^nosuch]\n').map((d) => d.rule)).toContain('unresolved-footnote')
  })
})

describe('an AST-JSON payload whose node type names a prototype key', () => {
  for (const key of PROTOTYPE_KEYS) {
    it(`refuses type "${key}" as an unknown node type`, () => {
      // `WIRE_FIELDS['toString']` is a function, so the "does the schema name
      // this type" check said yes and the closed-field walk then threw a bare
      // `TypeError: known is not iterable` - an untyped crash where an unknown
      // type has a named error.
      const payload = { type: 'document', srcByteLength: 1, children: [{ type: key }] }

      expect(() => fromAstJson(JSON.parse(JSON.stringify(payload)))).toThrow(
        AstJsonUnknownNodeTypeError,
      )
    })
  }

  it('refuses an ordinary unknown node type the same way (control)', () => {
    expect(() =>
      fromAstJson({ type: 'document', srcByteLength: 1, children: [{ type: 'widget' }] } as never),
    ).toThrow(AstJsonUnknownNodeTypeError)
  })

  for (const key of PROTOTYPE_KEYS) {
    it(`adopts a footnote definition labelled ${key} rather than dropping it`, () => {
      // The adoption read `footnoteDefs[label] === undefined` to mean "not seen
      // yet". For a prototype key it answered "already present", so the
      // definition was discarded with no error and the reference then rendered
      // as literal text - the silent repair strict ingest exists to stop.
      const payload = JSON.parse(
        JSON.stringify({
          type: 'document',
          srcByteLength: 1,
          children: [
            {
              type: 'footnote',
              label: key,
              children: [{ type: 'paragraph', children: [{ type: 'text', value: 'the body' }] }],
            },
            { type: 'paragraph', children: [{ type: 'footnote_ref', id: key }] },
          ],
        }),
      )
      const html = renderHtml(fromAstJson(payload))

      expect(html).toContain('doc-noteref')
      expect(html).toContain('the body')
    })

    it(`leaves a reference to an undefined ${key} unresolved`, () => {
      const payload = JSON.parse(
        JSON.stringify({
          type: 'document',
          srcByteLength: 1,
          children: [{ type: 'paragraph', children: [{ type: 'footnote_ref', id: key }] }],
        }),
      )

      expect(renderHtml(fromAstJson(payload))).toContain(`[^${key}]`)
    })
  }
})

describe('an inline extension role that names a prototype key', () => {
  // `e.renderers?.[node.name]` reached the prototype whenever ANY extension
  // carrying a renderer record was loaded - an everyday configuration, not an
  // exotic one. `:valueOf[x]` threw; `:constructor[x]` rendered
  // `[object Object]`; `:toString[x]` rendered `[object Undefined]`.
  const withRenderers = { name: 'probe', renderers: { real: () => '<b>R</b>' } }

  it('still dispatches a role the extension actually registered (control)', () => {
    expect(carveToHtml(':real[x]', { extensions: [withRenderers] })).toContain('<b>R</b>')
  })

  for (const key of PROTOTYPE_KEYS) {
    it(`falls through to the generic rendering for :${key}[x]`, () => {
      const withExtension = carveToHtml(`:${key}[x]`, { extensions: [withRenderers] })

      // The same output a document with no extension loaded gets: an extension
      // that did not register this name has not handled it.
      expect(withExtension).toBe(carveToHtml(`:${key}[x]`))
      expect(withExtension).toContain(`ext-${key}`)
      expect(withExtension).not.toContain('[object')
    })
  }
})

describe('a symbol that names a prototype key', () => {
  // Symbol bodies are emitted RAW by design (trusted processor config), so a
  // lookup that walks the prototype chain puts a function's source text on the
  // page unescaped, and would put arbitrary markup there in any host whose
  // `Object.prototype` has been polluted.
  for (const key of PROTOTYPE_KEYS) {
    it(`emits :${key}: literally when the symbols map does not define it`, () => {
      const html = carveToHtml(`a :${key}: b`, { symbols: { ok: 'X' } })

      expect(html).toContain(`:${key}:`)
      expect(html).not.toContain('native code')
    })

    it(`still emits a symbol the caller did define under the name ${key}`, () => {
      // `__proto__` cannot be a symbol NAME - the shortcode's first character
      // may not be an underscore - so there is nothing for the caller to
      // define and the literal case above is the whole story for it.
      if (key === '__proto__') return
      const symbols: Record<string, string> = {}
      Object.defineProperty(symbols, key, { value: 'GLYPH', enumerable: true, writable: true })

      expect(carveToHtml(`a :${key}: b`, { symbols })).toContain('GLYPH')
    })
  }

  it('emits a symbol under an ordinary name (control)', () => {
    expect(carveToHtml('a :ok: b', { symbols: { ok: 'X' } })).toContain('X')
  })
})

describe('an SVG character reference that names a prototype key', () => {
  /**
   * The sanitizer decodes entities before running its URL and CSS checks, and
   * `NAMED_REFS['constructor']` answered with a function - so `&constructor;`
   * expanded to `function Object() { [native code] }` inside the very string
   * those checks read.
   *
   * `constructor` is the ONLY key that reaches this table: the lookup lowercases
   * the entity name first, so `toString` arrives as `tostring`, which is on
   * nothing. That makes this one input rather than the eight the rest of the
   * file carries, and it is a real bypass rather than cosmetic.
   *
   * A reference-valued attribute is checked per `;`-separated segment, and the
   * absolute-scheme test is anchored at the start of a segment. The fabricated
   * function text carries no `;`, so it welds the segments into one and the
   * external URL is no longer at the start of anything - the check then sees a
   * segment beginning `redfunction Object…` and passes it.
   */
  const rect = (fill: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="${fill}"/></svg>`

  it('keeps an ordinary colour (control)', () => {
    expect(sanitizeSvg(rect('red')).svg).toContain('fill="red"')
  })

  it('drops an absolute URL in a later segment (control)', () => {
    expect(sanitizeSvg(rect('red;https://evil.example/y')).svg).not.toContain('evil.example')
  })

  it('drops it when an unknown entity stands where the separator does', () => {
    expect(sanitizeSvg(rect('red&nosuchentity;https://evil.example/y')).svg).not.toContain(
      'evil.example',
    )
  })

  it('drops it when that entity is &constructor;', () => {
    expect(sanitizeSvg(rect('red&constructor;https://evil.example/y')).svg).not.toContain(
      'evil.example',
    )
  })

  it('still decodes a reference the table does name (control)', () => {
    // `javascript&colon;alert(1)` is the obfuscation the table exists to undo:
    // the destination has to be blanked, which only happens if `&colon;`
    // decoded to a colon.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript&colon;alert(1)">x</a></svg>'

    expect(sanitizeSvg(svg).svg).not.toContain('javascript')
  })
})
