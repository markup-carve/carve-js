import { readFileSync } from 'node:fs'

import { parseFragment } from 'parse5'
import { describe, expect, it } from 'vitest'

import { sanitizeSvg, type SanitizeSvgOptions } from '../../extensions/blocks/svg-sanitize.ts'
import { STYLE_PATTERNS } from '../../src/render-tables.ts'

// The rows carve-php SvgSanitizer pins (carve-php#6013, tests/fixtures/svg-sanitize/parity.json): both engines
// write the same bytes for each of them.
interface Row { from: string, src: string, opts: SanitizeSvgOptions, svg: string, ok: boolean }
const ROWS: Row[] = JSON.parse(readFileSync(new URL('../fixtures/svg-sanitize/parity.json', import.meta.url), 'utf8')) as Row[]
// Rows whose bytes a js-first ruling changed before carve-php ports it; each names its ticket.
interface Delta { index: number, tickets: string[], src: string, svg: string, ok: boolean }
const DELTAS: Delta[] = JSON.parse(readFileSync(new URL('../fixtures/svg-sanitize/parity-js-first.json', import.meta.url), 'utf8')) as Delta[]
const DELTA_AT = new Map(DELTAS.map((delta) => [delta.index, delta]))

interface Node { nodeName: string, attrs?: { name: string, value: string }[], childNodes?: Node[], content?: Node }

const FORBIDDEN = new Set(['script', 'foreignobject', 'style', 'iframe'])
const ANIMATION_VALUES = new Set(['values', 'from', 'to', 'by'])

function cssCompact(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-f]{1,6}\s?|[\s\S])/gi, (_m, esc: string) =>
      /^[0-9a-f]/i.test(esc) ? String.fromCodePoint(Math.min(Number.parseInt(esc.trim(), 16), 0x10ffff)) : esc)
    .toLowerCase().replace(/\s+/g, '')
}

function attrProblems(tag: string, attrs: { name: string, value: string }[]): string[] {
  const problems: string[] = []
  const animatesHref = attrs.some((a) => a.name.toLowerCase() === 'attributename' && /^(xlink:)?href$/i.test(a.value.trim()))
  for (const { name, value } of attrs) {
    const n = name.toLowerCase()
    const css = cssCompact(value)
    if (n.startsWith('on')) problems.push(`handler ${name}`)
    if (n === 'style' && (STYLE_PATTERNS.some((p) => css.includes(p)) || css.includes('javascript:'))) problems.push(`style ${value}`)
    if ((n === 'href' || n === 'xlink:href') && tag !== 'a' && tag !== 'image' && !value.trim().startsWith('#')) problems.push(`href ${value}`)
    if (animatesHref && ANIMATION_VALUES.has(n) && value.split(';').some((s) => s.trim() !== '' && !s.trim().startsWith('#'))) {
      problems.push(`animated href ${value}`)
    }
  }
  return problems
}

/** Problems an HTML parser sees in a kept output: active elements, handlers, fetching styles, non-local animated hrefs. */
function liveProblems(svg: string): string[] {
  const problems: string[] = []
  const walk = (node: Node): void => {
    const tag = node.nodeName.toLowerCase()
    if (FORBIDDEN.has(tag)) problems.push(`element ${tag}`)
    problems.push(...attrProblems(tag, node.attrs ?? []))
    for (const child of node.childNodes ?? []) walk(child)
    if (node.content) walk(node.content)
  }
  walk(parseFragment(svg) as unknown as Node)
  return problems
}

let seed = 1
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)]!
const quoted = (value: string): string => (rnd() < 0.5 ? `"${value.replace(/"/g, '&quot;')}"` : `'${value.replace(/'/g, '&apos;')}'`)

function sweep(name: string, make: () => { src: string, opts: SanitizeSvgOptions }, check: (svg: string, src: string) => void): void {
  it(`${name}: 1,000 variants keep nothing live`, () => {
    seed = 7
    let kept = 0
    for (let i = 0; i < 1000; i++) {
      const { src, opts } = make()
      const { svg, ok } = sanitizeSvg(src, opts)
      if (!ok) continue
      kept++
      expect(liveProblems(svg), src).toEqual([])
      check(svg, src)
    }
    expect(kept).toBeGreaterThan(900)
  })
}

describe('sanitizeSvg parity with carve-php', () => {
  it('writes the pinned bytes for every row', () => {
    const differ = ROWS.filter((row, index) => {
      const want = DELTA_AT.get(index) ?? row
      const got = sanitizeSvg(row.src, row.opts)
      return got.svg !== want.svg || got.ok !== want.ok
    }).map((row) => row.src)
    expect(differ).toEqual([])
    expect(ROWS.length).toBe(770)
  })

  it('records only real deltas, each with its ticket', () => {
    for (const delta of DELTAS) {
      const row = ROWS[delta.index]!
      expect(delta.src).toBe(row.src)
      expect(delta.svg === row.svg && delta.ok === row.ok, row.src).toBe(false)
      expect(delta.tickets.every((ticket) => ['carve#6763', 'carve#6764', 'carve#6765', 'carve#6774', 'carve#6782'].includes(ticket))).toBe(true)
    }
  })

  it('keeps every accepted row inert in an HTML parser', () => {
    let checked = 0
    for (const row of ROWS) {
      const { svg, ok } = sanitizeSvg(row.src, row.opts)
      if (!ok) continue
      checked++
      expect(liveProblems(svg), row.src).toEqual([])
    }
    expect(checked).toBeGreaterThan(500)
  })
})

describe('sanitizeSvg root xmlns (carve#6755)', () => {
  it('keeps an xmlns inside a value', () => {
    expect(sanitizeSvg('<svg id="a xmlns=b"><rect id="x onload=alert(1) y"/></svg>').svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" id="a xmlns=b"><rect id="x onload=alert(1) y"/></svg>')
  })

  it('replaces the root xmlns attributes by name', () => {
    expect(sanitizeSvg('<svg xmlns="x" XMLNS="y" xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>').svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>')
    expect(sanitizeSvg('<svg xmlns><rect/></svg>').svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
  })

  const VALUES = ['a xmlns=b', 'xmlns=x', ' xmlns = "q', "xmlns='", 'x XMLNS=y', 'a\txmlns\n=\tb', 'xmlns=', 'a xmlns="b" c']
  const KIDS = ['x onload=alert(1) y', 'x" onload="alert(1)', "x' onload='alert(1)", 'q onclick=alert(1)', '"><img src=x onerror=alert(1)>']
  sweep('root xmlns', () => {
    const attrs = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => `${pick(['id', 'class', 'role', 'data-x', 'aria-label', 'xmlns'])}=${quoted(pick(VALUES))}`)
    const kids = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => `<${pick(['rect', 'g', 'text'])} ${pick(['id', 'class', 'data-y'])}=${quoted(pick(KIDS))}/>`)
    return { src: `<svg ${attrs.join(pick([' ', '\n', '\t']))}>${kids.join('')}</svg>`, opts: {} }
  }, (svg) => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    const root = (parseFragment(svg) as unknown as Node).childNodes![0]!
    expect(root.attrs!.filter((attr) => attr.name.toLowerCase() === 'xmlns').map((attr) => attr.value)).toEqual(['http://www.w3.org/2000/svg'])
  })
})

describe('sanitizeSvg style (carve#6760)', () => {
  it('drops a style with a CSS image function', () => {
    const styles = [
      'cursor:image-set("https://e.example/p.png" 1x),auto',
      'background:-webkit-image-set("https://e.example/p.png" 1x)',
      "background:image('https://e.example/p.png')",
      'background:src("https://e.example/p.png")',
      'background:IMAGE\\2d set("https://e.example/p.png" 1x)',
    ]
    for (const style of styles) {
      expect(sanitizeSvg(`<svg style='${style}'/>`, { allowStyle: true }).svg, style).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>')
    }
    expect(sanitizeSvg('<svg style="fill:red;cursor:pointer"/>', { allowStyle: true }).svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" style="fill:red;cursor:pointer"/>')
  })

  const FUNCS = ['image-set(', '-webkit-image-set(', 'image(', 'src(', 'url(', 'IMAGE-SET (', 'im\\61ge(', 'ima/**/ge-set(', 'image&#45;set(',
    's\\72 c(', 'Image\\2D Set(', 'expression(', '@import ', 'behavior:', '-moz-binding:', 'javascript:']
  sweep('style image functions', () => {
    const prop = pick(['cursor', 'background', 'background-image', 'mask', 'fill', 'list-style', 'border-image', 'content'])
    const style = `${pick(['', 'fill:red;'])}${prop}:${pick(FUNCS)}${pick(['"https://e.example/p.png"', "'//e.example/p'", 'https://e.example/p', '"x.png" 1x'])})`
    return { src: `<svg><rect style=${quoted(style)}/></svg>`, opts: { allowStyle: true } }
  }, (svg, src) => {
    expect(svg, src).not.toContain('style=')
  })
})

describe('sanitizeSvg href animation (carve#6761)', () => {
  const opts = { allowAnimation: true }
  it('keeps only local entries in an href animation', () => {
    expect(sanitizeSvg('<svg><use href="#x"><set attributeName="href" to="evil.svg#x"/></use></svg>', opts).svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"><use href="#x"><set attributeName="href"/></use></svg>')
    expect(sanitizeSvg('<svg><use href="#x"><animate attributeName="xlink:href" values="#a;evil.svg#x" dur="1s"/></use></svg>', opts).svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"><use href="#x"><animate attributeName="xlink:href" dur="1s"/></use></svg>')
    const local = '<svg xmlns="http://www.w3.org/2000/svg"><use href="#x"><animate attributeName="HREF" values="#a;#b;"/></use></svg>'
    expect(sanitizeSvg(local, opts).svg).toBe(local)
  })

  const NAMES = ['href', 'HREF', 'xlink:href', 'XLink:Href', ' href ', '&#104;ref', 'xlink&#58;href', 'h\\72 ef']
  const ENTRIES = ['#a', '#b', 'evil.svg#x', 'x.svg', '../a#b', ' #c', 'a#b', '%23x', '&#35;x', 'x&#35;y', '']
  sweep('href animation values', () => {
    const tag = pick(['set', 'animate'])
    const values = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(ENTRIES)).join(';')
    return { src: `<svg><use href="#x"><${tag} attributeName=${quoted(pick(NAMES))} ${pick([...ANIMATION_VALUES])}=${quoted(values)}/></use></svg>`, opts }
  }, () => undefined)
})

describe('sanitizeSvg quoted local url() (carve#6763)', () => {
  it('keeps quoted and spaced local references', () => {
    expect(sanitizeSvg(`<svg><rect fill="url('#g')"/><rect fill='url("#g")'/><rect fill="url( #g)"/></svg>`).svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(\'#g\')"/><rect fill="url(&quot;#g&quot;)"/><rect fill="url( #g)"/></svg>')
  })

  const LOCAL = ['url(#g)', "url('#g')", 'url("#g")', 'url( #g)', "url( ' #g' )", 'URL(#g)', "url(\t'#g')", 'url(&quot;#g&quot;)']
  const REMOTE = ["url('https://e.example/p#g')", 'url( "//e.example/x")', "url('x.svg#g')", "url(' x#g')", 'url( "")', "url('#g') url(x)",
    "url('#g'),url('//e')", 'u\\72l("x#g")', "url(\"'#g')"]
  sweep('quoted url() references', () => {
    const remote = rnd() < 0.5
    const value = remote ? pick(REMOTE) : pick(LOCAL)
    const attr = pick(['fill', 'stroke', 'mask', 'clip-path', 'marker-end', 'class', 'id'])
    return { src: `<svg><rect ${attr}=${quoted(value)}/></svg>`, opts: pick([{}, { allowStyle: true }]) }
  }, (svg, src) => {
    const kept = /<rect [^>]*=/.test(svg)
    const remote = REMOTE.some((value) => src.includes(value.replace(/"/g, '&quot;')) || src.includes(value.replace(/'/g, '&apos;')) || src.includes(value))
    expect(kept, src).toBe(!remote)
  })
})

describe('sanitizeSvg url() skips only CSS whitespace (carve#6773)', () => {
  it('drops a reference with a no-break space before #', () => {
    expect(sanitizeSvg('<svg><rect fill="url(\u00a0#g)"/><rect fill="url(\'\u00a0#g\')"/></svg>').svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect/><rect/></svg>')
  })

  const NON_CSS_SPACE = ['\u00a0', '\u1680', '\u2000', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff']
  const CSS_SPACE = [' ', '\t', '\n', '\r', '\f', '']
  sweep('non-CSS whitespace around the url() quote', () => {
    const before = pick(CSS_SPACE) + (rnd() < 0.5 ? pick(NON_CSS_SPACE) : '') + pick(CSS_SPACE)
    const after = pick(CSS_SPACE) + (rnd() < 0.5 ? pick(NON_CSS_SPACE) : '') + pick(CSS_SPACE)
    const quote = pick(['', "'", '"'])
    const value = `${pick(['url', 'URL'])}(${before}${quote}${after}#g${quote})`
    const attr = pick(['fill', 'stroke', 'mask', 'clip-path', 'class', 'values'])
    return { src: `<svg><rect ${attr}=${quoted(value)}/></svg>`, opts: pick([{}, { allowStyle: true }]) }
  }, (svg, src) => {
    const kept = /<rect [^>]*=/.test(svg)
    expect(kept, src.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)).toBe(!NON_CSS_SPACE.some((space) => src.includes(space)))
  })
})

const NON_XML_CHAR = /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
const isXmlChar = (cp: number): boolean =>
  cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff)

describe('sanitizeSvg XML characters (carve#6764)', () => {
  it('escapes a numeric reference outside XML Char', () => {
    expect(sanitizeSvg('<svg><text>&#0;</text><text>a&#x1;b</text></svg>').svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"><text>&amp;#0;</text><text>a&amp;#x1;b</text></svg>')
    expect(sanitizeSvg('<svg><text>&#9;&#x20;&#xD7FF;&#xFFFD;&#x10FFFF;</text></svg>').svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"><text>&#9;&#x20;&#xD7FF;&#xFFFD;&#x10FFFF;</text></svg>')
  })

  it('drops a raw character outside XML Char before any check', () => {
    expect(sanitizeSvg('<svg id="a\u0001b"><text>x\u0000y\uFFFE\uD800z</text></svg>').svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" id="ab"><text>xyz</text></svg>')
    expect(sanitizeSvg('<svg style="background:ur\u0001l(https://e.example/p)"/>', { allowStyle: true }).svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"/>')
  })

  const BAD = ['&#0;', '&#x1;', '&#8;', '&#xB;', '&#12;', '&#x1F;', '&#xD800;', '&#xDFFF;', '&#xFFFE;', '&#65535;', '&#x110000;', '&#99999999;',
    '\u0000', '\u0001', '\u000B', '\u001F', '\uFFFE', '\uFFFF', '\uD800', '\uDC00']
  const GOOD = ['&#9;', '&#xA;', '&#13;', '&#32;', '&#xE000;', '&#x1F600;', '\uD83D\uDE00', 'a', '&amp;', '&lt;']
  sweep('XML characters', () => {
    const text = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => (rnd() < 0.5 ? pick(BAD) : pick(GOOD))).join('')
    return { src: rnd() < 0.5 ? `<svg><text>${text}</text></svg>` : `<svg><rect id=${quoted(text)}/></svg>`, opts: {} }
  }, (svg, src) => {
    expect(svg, src).not.toMatch(NON_XML_CHAR)
    for (const ref of svg.matchAll(/&#(x[0-9a-f]+|\d+);/gi)) {
      const cp = ref[1]![0]!.toLowerCase() === 'x' ? Number.parseInt(ref[1]!.slice(1), 16) : Number.parseInt(ref[1]!, 10)
      expect(isXmlChar(cp), src).toBe(true)
    }
  })
})

describe('sanitizeSvg animateTransform and animateMotion (carve#6765)', () => {
  const opts = { allowAnimation: true }
  it('keeps both under allowAnimation', () => {
    const transform = '<svg xmlns="http://www.w3.org/2000/svg"><rect><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s"/></rect></svg>'
    expect(sanitizeSvg('<svg><rect><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="1s"/></rect></svg>', opts).svg).toBe(transform)
    expect(sanitizeSvg('<svg><path id="p"/><circle><animateMotion dur="2s"><mpath href="#p"/></animateMotion></circle></svg>', opts).svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"><path id="p"/><circle><animateMotion dur="2s"><mpath href="#p"/></animateMotion></circle></svg>')
    expect(sanitizeSvg('<svg><rect><animateTransform attributeName="transform"/></rect></svg>').svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')
  })

  const TAGS = ['animateTransform', 'animatetransform', 'ANIMATEMOTION', 'animateMotion', 'set', 'animate']
  const ATTRS = ['attributeName="href"', 'attributeName="transform"', 'attributeName="xlink:href"', 'onbegin="alert(1)"', 'href="evil.svg#x"',
    'xlink:href="javascript:alert(1)"', 'values="#a;evil.svg"', 'from="0"', 'to="url(https://e.example/x)"', 'by="1"', 'type="scale"',
    'style="fill:url(https://e.example)"', 'path="M0 0"', 'values="0;1"']
  sweep('animateTransform and animateMotion', () => {
    const tag = pick(TAGS)
    const attrs = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick(ATTRS)).join(' ')
    const kid = rnd() < 0.3 ? `<mpath href=${quoted(pick(['#p', 'evil.svg#p', 'javascript:x']))}/>` : ''
    return { src: `<svg><use href="#x"><${tag} ${attrs}>${kid}</${tag}></use></svg>`, opts: pick([opts, { allowAnimation: true, allowStyle: true }]) }
  }, (svg, src) => {
    expect(svg, src).toContain(`<${/<use href="#x"><(\w+)/.exec(src)![1]!}`)
  })
})

const XML_REF = /&(#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);/y
function refProblems(text: string): string[] {
  const problems: string[] = []
  for (let at = text.indexOf('&'); at >= 0; at = text.indexOf('&', at + 1)) {
    XML_REF.lastIndex = at
    if (!XML_REF.test(text)) problems.push(`reference at ${text.slice(at, at + 8)}`)
  }
  if (text.includes('<')) problems.push('raw <')
  return problems
}

function tagProblems(name: string, attrs: string): string[] {
  const problems: string[] = []
  const names = [...attrs.matchAll(/([^\s=/>]+)\s*=\s*"([^"]*)"/g)].map((a) => {
    problems.push(...refProblems(a[2]!))
    return a[1]!
  })
  if (new Set(names).size !== names.length) problems.push(`duplicate attribute on ${name}`)
  return problems
}

/** What an XML parser would refuse in a kept output: unquoted or valueless attributes, duplicates, unbalanced tags, bad references. */
function xmlProblems(svg: string): string[] {
  const problems: string[] = []
  const stack: string[] = []
  const token = /<(\/?)([A-Za-z_:][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*"[^"]*")*)\s*(\/?)>|<|[^<]+/g
  for (const [text, close, name, attrs, self] of svg.matchAll(token)) {
    if (name === undefined) problems.push(...(text === '<' ? ['unparsed tag'] : refProblems(text)))
    else if (close === '/') {
      if (stack.pop() !== name) problems.push(`close ${name}`)
    } else {
      problems.push(...tagProblems(name, attrs!))
      if (self !== '/') stack.push(name)
    }
  }
  if (stack.length > 0) problems.push(`unclosed ${stack.join(',')}`)
  return problems
}

describe('sanitizeSvg valueless attributes (carve#6774)', () => {
  it('drops an attribute without a value', () => {
    expect(sanitizeSvg('<svg id/>')).toEqual({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', ok: true })
    expect(sanitizeSvg('<svg><rect width fill/></svg>')).toEqual({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', ok: true })
    expect(sanitizeSvg('<svg xml:space aria-hidden data-x ID><text x="1" role>a</text></svg>').svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"><text x="1">a</text></svg>')
    expect(sanitizeSvg('<svg><rect><animate attributeName="x" to from/></rect></svg>', { allowAnimation: true }).svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect><animate attributeName="x"/></rect></svg>')
    expect(sanitizeSvg('<svg width = height="2"/>').svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="height=&quot;2&quot;"/>')
  })

  const BARE = ['id', 'ID', 'width', 'fill', 'stroke', 'xml:space', 'xmlns', 'xmlns:xlink', 'XMLNS', 'class', 'role', 'aria-hidden', 'data-x',
    'style', 'href', 'xlink:href', 'onload', 'values', 'to', 'from', 'attributeName', 'stop-color', 'version', 'viewBox', 'x']
  const VALUED = ['id="a"', 'width="1"', 'fill="url(#g)"', "fill=\"url('#g')\"", 'fill="url( #g)"', 'style="fill:red"',
    'style="cursor:image-set(&quot;https://e.example/p.png&quot; 1x)"', 'class="a xmlns=b"', 'xmlns="x"', 'id="a&#1;b"', 'id="&#9;x"',
    'attributeName="href"', 'values="#a;evil.svg"', 'to="#b"', 'href="#x"', 'href="https://e.example/x"', 'onload="alert(1)"', 'id="x\u0001y"']
  const attrs = (): string => Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => (rnd() < 0.5 ? pick(BARE) : pick(VALUED)))
    .join(pick([' ', '\n', '\t', '  ']))
  it('keeps every accepted parity row well-formed XML', () => {
    for (const row of ROWS) {
      const { svg, ok } = sanitizeSvg(row.src, row.opts)
      if (ok) expect(xmlProblems(svg), row.src).toEqual([])
    }
  })

  sweep('valueless attributes', () => {
    const kids = Array.from({ length: Math.floor(rnd() * 3) }, () => {
      const tag = pick(['rect', 'g', 'text', 'use', 'a', 'image', 'animate', 'set', 'animateTransform', 'animateMotion', 'stop'])
      return rnd() < 0.5 ? `<${tag} ${attrs()}/>` : `<${tag} ${attrs()}>${pick(['', 'x', '&#0;', '&amp;'])}</${tag}>`
    })
    const opts = pick([{}, { allowStyle: true }, { allowAnimation: true }, { allowLinks: true, allowExternalImages: true },
      { allowLinks: true, allowStyle: true, allowAnimation: true, allowExternalImages: true }])
    return { src: `<svg ${attrs()}>${kids.join('')}</svg>`, opts }
  }, (svg, src) => {
    expect(xmlProblems(svg), src).toEqual([])
  })
})

function startTagNamespaceProblems(attrs: string, scope: Set<string>): string[] {
  const problems: string[] = []
  const pairs = [...attrs.matchAll(/([^\s=/>]+)\s*=\s*"([^"]*)"/g)].map((a) => [a[1]!, a[2]!] as const)
  for (const [name, value] of pairs.filter(([name]) => name.startsWith('xmlns:'))) {
    if (value === '') problems.push(`undeclared prefix ${name}`)
    else scope.add(name.slice(6))
  }
  for (const [name] of pairs) {
    const prefix = name.split(':')[0]!
    if (name.includes(':') && prefix !== 'xmlns' && !scope.has(prefix)) problems.push(`unbound prefix ${name}`)
  }
  return problems
}

/** Namespaces in XML 1.0 errors in a kept output: an empty prefixed declaration or a prefix nothing declares. */
function namespaceProblems(svg: string): string[] {
  const problems: string[] = []
  const scopes: Set<string>[] = [new Set(['xml'])]
  for (const [, close, attrs, self] of svg.matchAll(/<(\/?)[A-Za-z_:][\w:.-]*((?:\s+[^\s=/>]+\s*=\s*"[^"]*")*)\s*(\/?)>/g)) {
    if (close === '/') {
      scopes.pop()
      continue
    }
    const scope = new Set(scopes.at(-1))
    problems.push(...startTagNamespaceProblems(attrs!, scope))
    if (self !== '/') scopes.push(scope)
  }
  return problems
}

describe('sanitizeSvg empty prefixed namespace declarations (carve#6779)', () => {
  it('drops an xmlns:xlink with an empty value', () => {
    expect(sanitizeSvg('<svg xmlns:xlink=""><rect/></svg>')).toEqual({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', ok: true })
    expect(sanitizeSvg('<svg><g xmlns:xlink=""/></svg>')).toEqual({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', ok: true })
    expect(sanitizeSvg("<svg XMLNS:XLINK='' id=\"a\"><g xmlns:xlink = ''></g></svg>").svg)
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" id="a"><g/></svg>')
  })

  it('keeps a non-empty one', () => {
    const xlink = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/></svg>'
    expect(sanitizeSvg('<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a"/></svg>')).toEqual({ svg: xlink, ok: true })
    // carve#6783: a namespace name of whitespace only is dropped like the empty one.
    expect(sanitizeSvg('<svg><g xmlns:xlink=" "/></svg>').svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')
  })

  // carve#6811: a value holding whitespace or a no-break space anywhere is no URI reference libxml2 accepts.
  it.each([' urn:x', 'urn:x ', 'urn: x', 'urn:x\tb', '\u00a0', 'urn:\u00a0x', '&#160;', 'urn:&#xA0;x', '&#32;urn:x', 'urn:&nbsp;x'])(
    'drops xmlns:xlink="%s"', (value) => {
      expect(sanitizeSvg(`<svg><g xmlns:xlink="${value}"/></svg>`)).toEqual({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', ok: true })
    })

  it('keeps a clean value that is not the XLink namespace', () => {
    expect(sanitizeSvg('<svg><g xmlns:xlink="urn:x"/></svg>').svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"><g xmlns:xlink="urn:x"/></svg>')
  })

  const DECLS = ['xmlns:xlink=""', "xmlns:xlink=''", 'xmlns:xlink = ""', 'xmlns:xlink="http://www.w3.org/1999/xlink"', 'xmlns:xlink="x"', 'xmlns:xlink=" urn:x"', 'xmlns:xlink="&#160;"',
    'xmlns:xlink', 'xmlns:foo=""', 'xmlns:foo="urn:a"', 'xmlns=""', 'xmlns="urn:a"', 'id="a"', 'fill="red"']
  const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"'
  sweep('empty prefixed namespace declarations', () => {
    const decls = (): string => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(DECLS)).join(' ')
    const kids = Array.from({ length: Math.floor(rnd() * 3) }, () => {
      const tag = pick(['rect', 'g', 'use', 'text'])
      const href = tag === 'use' && rnd() < 0.5 ? ' href="#a"' : ''
      return rnd() < 0.5 ? `<${tag} ${decls()}${href}/>` : `<${tag} ${decls()}${href}><rect ${decls()}/></${tag}>`
    })
    return { src: `<svg ${rnd() < 0.3 ? XLINK + ' ' : ''}${decls()}>${kids.join('')}</svg>`, opts: pick([{}, { allowLinks: true }]) }
  }, (svg, src) => {
    expect(xmlProblems(svg), src).toEqual([])
    expect(namespaceProblems(svg), src).toEqual([])
  })
})

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg"'
const XLINK_DECL = 'xmlns:xlink="http://www.w3.org/1999/xlink"'

function strictStartTagProblems(attrs: string, scope: Set<string>): string[] {
  const problems: string[] = []
  const pairs = [...attrs.matchAll(/([^\s=/>]+)\s*=\s*"([^"]*)"/g)].map((a) => [a[1]!, a[2]!] as const)
  for (const [name, value] of pairs.filter(([name]) => name.startsWith('xmlns:'))) {
    const read = value.replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    if (read.trim() === '') problems.push(`blank declaration ${name}`)
    else scope.add(name.slice(6))
  }
  for (const [name] of pairs) {
    const prefix = name.split(':')[0]!
    if (name.includes(':') && prefix !== 'xmlns' && !scope.has(prefix)) problems.push(`unbound prefix ${name}`)
  }
  return problems
}

/** Namespaces in XML 1.0 errors, strict: a prefix nothing binds, or a declaration whose value is blank once its references are read. */
function strictNamespaceProblems(svg: string): string[] {
  const problems: string[] = []
  const scopes: Set<string>[] = [new Set(['xml'])]
  for (const [, close, attrs, self] of svg.matchAll(/<(\/?)[A-Za-z_:][\w:.-]*((?:\s+[^\s=/>]+\s*=\s*"[^"]*")*)\s*(\/?)>/g)) {
    if (close === '/') {
      scopes.pop()
      continue
    }
    const scope = new Set(scopes.at(-1))
    problems.push(...strictStartTagProblems(attrs!, scope))
    if (self !== '/') scopes.push(scope)
  }
  return problems
}

describe('sanitizeSvg binds the xlink prefix (carve#6782)', () => {
  it('declares xlink on the root when nothing in scope does', () => {
    expect(sanitizeSvg('<svg><use xlink:href="#a"/></svg>'))
      .toEqual({ svg: `${SVG_OPEN} ${XLINK_DECL}><use xlink:href="#a"/></svg>`, ok: true })
    expect(sanitizeSvg('<svg xlink:href="#a" id="r"/>').svg).toBe(`${SVG_OPEN} ${XLINK_DECL} xlink:href="#a" id="r"/>`)
  })

  it('keeps an authored declaration in scope and adds none', () => {
    expect(sanitizeSvg('<svg xmlns:xlink="urn:x"><use xlink:href="#a"/></svg>').svg)
      .toBe(`${SVG_OPEN} xmlns:xlink="urn:x"><use xlink:href="#a"/></svg>`)
    expect(sanitizeSvg('<svg><use xlink:href="#a" xmlns:xlink="urn:x"/></svg>').svg)
      .toBe(`${SVG_OPEN}><use xlink:href="#a" xmlns:xlink="urn:x"/></svg>`)
    expect(sanitizeSvg('<svg><g xmlns:xlink="urn:x"><use xlink:href="#a"/></g></svg>').svg)
      .toBe(`${SVG_OPEN}><g xmlns:xlink="urn:x"><use xlink:href="#a"/></g></svg>`)
  })

  it('binds a use outside the subtree that declares it', () => {
    expect(sanitizeSvg('<svg><g xmlns:xlink="urn:x"><use xlink:href="#a"/></g><use xlink:href="#b"/></svg>').svg)
      .toBe(`${SVG_OPEN} ${XLINK_DECL}><g xmlns:xlink="urn:x"><use xlink:href="#a"/></g><use xlink:href="#b"/></svg>`)
  })

  it('adds nothing when the xlink attribute is dropped', () => {
    expect(sanitizeSvg('<svg><use xlink:href="https://e/x"/><use XLINK:HREF="#a"/></svg>').svg).toBe(`${SVG_OPEN}><use/><use/></svg>`)
    expect(sanitizeSvg('<svg><script><use xlink:href="#a"/></script></svg>').svg).toBe(`${SVG_OPEN}/>`)
  })
})

describe('sanitizeSvg namespace names (carve#6783)', () => {
  it('drops a prefixed name in any other spelling', () => {
    expect(sanitizeSvg('<svg XMLNS:XLINK="http://www.w3.org/1999/xlink"><rect/></svg>'))
      .toEqual({ svg: `${SVG_OPEN}><rect/></svg>`, ok: true })
    expect(sanitizeSvg('<svg Xmlns:xlink="urn:x" XML:SPACE="preserve" data-a:b="1" aria-x:y="2" xml:space="preserve"/>').svg)
      .toBe(`${SVG_OPEN} xml:space="preserve"/>`)
  })

  it('drops a declaration of whitespace only', () => {
    expect(sanitizeSvg('<svg xmlns:xlink=" "><rect/></svg>')).toEqual({ svg: `${SVG_OPEN}><rect/></svg>`, ok: true })
    for (const value of ['\t', ' \n ', '\r', '&#32;', '&#x20;&#9;', '&#xA;', '&#13;', '&#x0D;']) {
      expect(sanitizeSvg(`<svg><g xmlns:xlink="${value}"/></svg>`).svg, value).toBe(`${SVG_OPEN}><g/></svg>`)
    }
    // carve#6811 replaces the carve#6783 reading that kept these two.
    expect(sanitizeSvg('<svg><g xmlns:xlink=" urn:x "/></svg>').svg).toBe(`${SVG_OPEN}><g/></svg>`)
    expect(sanitizeSvg('<svg><g xmlns:xlink="&#160;"/></svg>').svg).toBe(`${SVG_OPEN}><g/></svg>`)
  })

  const NAMES = ['xmlns:xlink', 'XMLNS:XLINK', 'Xmlns:xlink', 'xmlns:XLINK', 'xlink:href', 'XLINK:HREF', 'Xlink:href', 'xml:space',
    'XML:SPACE', 'data-a:b', 'aria-x:y', 'id', 'fill']
  const VALUES = ['', ' ', '\t', ' \n', '&#32;', '&#x9;', '&#xa;', '#a', 'http://www.w3.org/1999/xlink', 'urn:x', ' urn:x', 'preserve', 'red']
  sweep('namespace names and xlink scope', () => {
    const attrs = (): string => Array.from({ length: Math.floor(rnd() * 3) }, () => `${pick(NAMES)}=${quoted(pick(VALUES))}`).join(' ')
    const leaf = (): string => `<${pick(['use', 'rect', 'g', 'textPath'])} ${attrs()}/>`
    const kids = Array.from({ length: Math.floor(rnd() * 3) }, () => {
      if (rnd() < 0.5) return leaf()
      const tag = pick(['g', 'defs', 'text', 'script'])
      return `<${tag} ${attrs()}>${leaf()}${rnd() < 0.5 ? leaf() : ''}</${tag}>`
    })
    return { src: `<svg ${attrs()}>${kids.join('')}</svg>`, opts: pick([{}, { allowLinks: true }]) }
  }, (svg, src) => {
    expect(xmlProblems(svg), src).toEqual([])
    expect(strictNamespaceProblems(svg), src).toEqual([])
    expect(svg.split(XLINK_DECL).length - 1 <= (src.split(XLINK_DECL).length - 1) + 1, src).toBe(true)
  })
})
