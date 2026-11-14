// The findings of the first code review of the 0.2 engine, one test per finding, named with the clause each one cites.
import { describe, expect, it } from 'vitest'
import { CarveTreeError, decodeTree, parse, render, stringOffsetOfByte, utf8Length, writeWithDiagnostics } from '../src/index.ts'
import { CarveOptionError } from '../src/options.ts'

/** The path and the reason of the refusal of `json`, or null when it is accepted. */
function refusal(json: unknown): string | null {
  try {
    decodeTree(JSON.stringify(json))
    return null
  } catch (error) {
    if (!(error instanceof CarveTreeError)) throw error
    return error.message
  }
}

const DIGEST = `sha256:${'0'.repeat(64)}`

function inParagraph(...children: unknown[]): Record<string, unknown> {
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children }] }
}

describe('linear passes', () => {
  it('C2-I-099: a term reads the character behind the empty spans that follow it, and many spans stay linear', () => {
    expect(render('*[A]: B\n\nA[]{.x}[]{.x} A[]{.x}b')).toBe(
      '<p><abbr title="B">A</abbr><span class="x"></span><span class="x"></span> A<span class="x"></span>b</p>',
    )
    const spans = parse(`*[A]: B\n\nA ${'[]{.x}'.repeat(20000)} A`).children.at(-1) as { children: { type: string }[] }
    expect(spans.children.filter((node) => node.type === 'abbreviation')).toHaveLength(2)
  })

  it('C2-A-035: a later key replaces an earlier one of the same name at its first place, over blocks and lines', () => {
    expect(parse('{k=1 j=2 K=3}\nx').children[0]!.attrs).toEqual({ keyValues: [['k', '3'], ['j', '2']] })
    expect(parse('{k=1}\n{j=2}\n{K=3}\nx').children[0]!.attrs).toEqual({ keyValues: [['k', '3'], ['j', '2']] })
    const many = parse(`{${Array.from({ length: 20000 }, (_, index) => `k${index % 10000}=${index}`).join(' ')}}\nx`).children[0]!
    expect(many.attrs?.keyValues).toHaveLength(10000)
    expect(many.attrs?.keyValues?.[0]).toEqual(['k0', '10000'])
  })

  it('C2-H-141: a reference and its definition with many keys merge, and the reference decides a key', () => {
    expect(render('[x][r]{a=1 B=2}\n\n{b=3 c=4}\n[r]: /u')).toBe('<p><a href="/u" c="4" a="1" B="2">x</a></p>')
  })
})

describe('reading a supplied tree', () => {
  it('C2-A-167, C2-A-170: a payload alternative that is no object with a media type is refused with its path', () => {
    const extension = (payload: unknown): unknown => inParagraph({ type: 'inline_extension', name: 'a.b', children: [], payload })
    expect(refusal(extension([null]))).toBe('/children/0/children/0/payload/0: not a payload alternative')
    expect(refusal(extension([{ value: 'x' }]))).toBe('/children/0/children/0/payload/0/format: not a string')
    expect(refusal(extension([{ format: '', value: 'x' }]))).toBe('/children/0/children/0/payload/0/format: an empty media type')
    expect(refusal(extension([{ format: 'text/plain', other: 1 }]))).toBe('/children/0/children/0/payload/0/other: not a field of a payload alternative')
    expect(refusal(extension([{ format: 'text/plain', value: { a: [1] } }]))).toBeNull()
  })

  it('C2-A-014 to C2-A-019: the envelope is checked before its document', () => {
    const document = { type: 'document', astVersion: '2.0', children: [] }
    expect(refusal({ astVersion: '3.0', document })).toBe('/astVersion: major version 3 is not read by this engine')
    expect(refusal({ astVersion: '2.01', document })).toBe('/astVersion: not major.minor')
    expect(refusal({ document })).toBe('/astVersion: a required field is missing')
    expect(refusal({ astVersion: '2.0', extensions: [{ name: 'a.b', required: true }], document })).toBe('/extensions/0: an unknown required extension')
    expect(refusal({ astVersion: '2.0', other: 1, document })).toBe('/other: not a field of the envelope')
    expect(refusal({ astVersion: '2.3', extensions: [{ name: 'a.b', required: false }], document })).toBeNull()
    expect(refusal({ astVersion: '2.0', document: { ...document, astVersion: '3.0' } })).toBe('/document/astVersion: major version 3 is not read by this engine')
  })

  it('C2-A-131: an image and an extension name resources of the manifest', () => {
    const resources = [{ id: 'r', mediaType: 'image/png', digest: DIGEST }]
    expect(refusal(inParagraph({ type: 'image', resourceId: 'missing' }))).toBe('/children/0/children/0/resourceId: no resource has the id "missing"')
    expect(refusal({ ...inParagraph({ type: 'image', resourceId: 'r' }), resources })).toBeNull()
    const extension = { type: 'inline_extension', name: 'a.b', children: [], resourceIds: ['r', 'q'] }
    expect(refusal({ ...inParagraph(extension), resources })).toBe('/children/0/children/0/resourceIds/1: no resource has the id "q"')
  })

  it('C2-A-132: references are counted in every slot that holds nodes, ruby pairs and extension slots included', () => {
    const resources = [{ id: 'r', mediaType: 'image/png', digest: DIGEST }]
    const images = (count: number): unknown[] => Array.from({ length: count }, () => ({ type: 'image', resourceId: 'r' }))
    const ruby = (count: number): unknown => ({ ...inParagraph({ type: 'ruby', pairs: [{ type: 'rubyPair', base: images(count), annotation: [] }] }), resources })
    expect(refusal(ruby(4096))).toBeNull()
    expect(refusal(ruby(4097))).toBe('/children/0/children/0/pairs/0/base/4096: more than 4096 resource references')
    const slots = (count: number): unknown => ({ ...inParagraph({ type: 'inline_extension', name: 'a.b', children: [], slots: { s: images(count) } }), resources })
    expect(refusal(slots(4096))).toBeNull()
    expect(refusal(slots(4097))).toBe('/children/0/children/0/slots/s/4096: more than 4096 resource references')
  })

  it('C2-A-028: a ruby pair is closed', () => {
    expect(refusal(inParagraph({ type: 'ruby', pairs: [{ type: 'rubyPair', base: [], annotation: [], x: 1 }] }))).toBe('/children/0/children/0/pairs/0/x: not a field of rubyPair')
  })
})

describe('the attribute filter', () => {
  it('C2-H-075, C2-H-161: the title and the datetime that abbr and time give pass the filter of an authored value', () => {
    expect(render('[x]{abbr=javascript:alert(1)}')).toBe('<p><abbr title="">x</abbr></p>')
    expect(render('[x]{time=javascript:alert(1)}')).toBe('<p><time datetime="">x</time></p>')
    expect(render('[x]{abbr="Shell: bash"}')).toBe('<p><abbr title="">x</abbr></p>')
    expect(render('[x]{abbr=HTML time=2024}')).toBe('<p><time datetime="2024"><abbr title="HTML">x</abbr></time></p>')
  })

  it('C2-H-161: an authored class and the language of a supplied tree pass the filter too', () => {
    expect(render('[x]{.a class="javascript:x"}')).toBe('<p><span class="a">x</span></p>')
    expect(render(decodeTree(JSON.stringify(inParagraph({ type: 'span', lang: 'javascript:x', children: [{ type: 'text', value: 'x' }] }))))).toBe('<p><span lang="">x</span></p>')
  })
})

describe('the title of a code block', () => {
  const titled = JSON.stringify({
    type: 'document', astVersion: '2.0',
    children: [{ type: 'code_block', value: 'a\n', title: [{ type: 'emphasis', children: [{ type: 'text', value: 'Hi' }] }, { type: 'text', value: ' there' }] }],
  })

  it('C2-A-073, C2-H-048: an inline title of a supplied tree is the title attribute as plain text', () => {
    expect(render(decodeTree(titled))).toBe('<pre title="Hi there"><code>a\n</code></pre>')
  })

  it('C2-W-117: the writer writes it as text and reports the markup it cannot spell', () => {
    const output = writeWithDiagnostics(decodeTree(titled))
    expect(output.source).toBe('``` "Hi there"\na\n```\n')
    expect(output.diagnostics.map((finding) => finding.code)).toContain('field-unspellable')
  })
})

describe('byte offsets', () => {
  it('C2-A-140: an offset inside a four-byte character gives the start of the character, never its second half', () => {
    expect([0, 1, 2, 3, 4].map((byte) => stringOffsetOfByte('😀x', byte))).toEqual([0, 0, 0, 0, 2])
    expect(stringOffsetOfByte('a😀', 3)).toBe(1)
  })

  it('C2-A-010: an unpaired surrogate counts as U+FFFD, three bytes, as UTF-8 encoders write it', () => {
    for (const text of ['\ud800x\n', 'a\udc00', '\udc00\ud800', '😀\ud800', 'é😀']) expect(utf8Length(text)).toBe(Buffer.byteLength(text))
    expect(parse('\ud800x\n').srcByteLength).toBe(5)
    expect(stringOffsetOfByte('\ud800x', 3)).toBe(1)
  })
})

describe('option values', () => {
  it('C2-H-137, C2-H-128: a urlPolicy that is not a deny list or an allow list of strings is refused', () => {
    const refused = (urlPolicy: unknown): string => {
      try {
        render('[x](javascript:y)', { urlPolicy } as never)
        return 'accepted'
      } catch (error) {
        return error instanceof CarveOptionError ? error.message : `other: ${String(error)}`
      }
    }
    expect(refused({ allow: 'https' })).toBe('option urlPolicy: allow is not a list of strings')
    expect(refused({ deny: [1] })).toBe('option urlPolicy: deny is not a list of strings')
    expect(refused({ allow: ['https'], deny: ['ftp'] })).toBe('option urlPolicy: both a deny list and an allow list')
    expect(refused({ other: [] })).toBe('option urlPolicy: unknown field other')
    expect(refused(null)).toBe('option urlPolicy: not an object with a deny list or an allow list')
    expect(refused(['ftp'])).toBe('option urlPolicy: not an object with a deny list or an allow list')
    expect(refused({ allow: ['https'] })).toBe('accepted')
  })

  it('C2-H-137: symbols, labels and social of the wrong shape are refused too', () => {
    expect(() => render('x', { symbols: { a: 1 } } as never)).toThrow(CarveOptionError)
    expect(() => render('x', { labels: 'x' } as never)).toThrow(CarveOptionError)
    expect(() => render('x', { social: { mentionUrl: 1 } } as never)).toThrow(CarveOptionError)
    expect(() => render('x', { social: { other: '' } } as never)).toThrow(CarveOptionError)
    expect(render('x', { symbols: {}, labels: {}, social: null })).toBe('<p>x</p>')
  })
})
