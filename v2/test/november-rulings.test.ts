import { describe, expect, it } from 'vitest'
import { format, parse, parseWithLayout, render, validateTree, write } from '../src/index.ts'

describe('ordered task boxes', () => {
  it('C2-B-046, C2-B-049, C2-A-060: every ordered style and delimiter keeps boxed and plain siblings', () => {
    for (const marker of ['1.', '1)', '.', 'a.', 'a)', 'A.', 'A)', 'i.', 'i)', 'II.', 'II)']) {
      const gap = marker.endsWith('.') && marker[0] === marker[0]?.toUpperCase() && /[A-Z]/.test(marker[0] ?? '') ? '  ' : ' '
      const document = parse(`${marker}${gap}[ ] milk\n${marker}${gap}bread\n`)
      const list = document.children[0]
      expect(list?.type, marker).toBe('list')
      if (list?.type !== 'list') continue
      expect(list.children.map((item) => item.task?.mark), marker).toEqual([' ', undefined])
      validateTree(document)
    }
  })

  it('C2-H-030, C2-H-032: an ordered task keeps its number and its list attributes', () => {
    const html = render('II) [x] a\nIII) b\n')
    expect(html).toContain('<ol type="I" start="2" data-delim=")" class="task-list">')
    expect(html).toContain('<li data-task-state="x" class="task"><input type="checkbox" checked disabled aria-label="a"> a</li>')
    expect(html).not.toContain('list-style: none')
    expect(render('- [ ] a\n')).toContain('<li class="task" style="list-style: none">')
  })

  it('C2-W-025, C2-W-046, C2-B-040: the writer keeps marker gaps and continuation alignment', () => {
    const source = 'A.  [x] one\n   more\nB.  two\n'
    const output = format(source)
    expect(output).toBe('A.  [x] one\n    more\nB.  two\n')
    expect(write(parse(output))).toBe(output)
  })
})

describe('shortcut references', () => {
  it('C2-I-072, C2-I-125, C2-A-105: a later definition forms link and image shortcuts', () => {
    const source = '[text] and ![text] and [missing]\n\n[text]: /u\n'
    const document = parse(source)
    const paragraph = document.children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') return
    expect(paragraph.children.map((node) => node.type)).toEqual(['link', 'text', 'image', 'text'])
    const link = paragraph.children[0]
    const image = paragraph.children[2]
    if (link?.type !== 'link' || image?.type !== 'image') return
    expect([link.refForm, link.key, link.href]).toEqual(['shortcut', 'text', '/u'])
    expect([image.refForm, image.key, image.src]).toEqual(['shortcut', 'text', '/u'])
    expect(paragraph.children[3]).toMatchObject({ type: 'text', value: ' and [missing]' })
    validateTree(document)
  })

  it('C2-I-081: a heading alone does not form a shortcut', () => {
    const paragraph = parse('[Title]\n\n# Title\n').children[0]
    expect(paragraph).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: '[Title]' }] })
    expect(render('[Title][] [x][Title]\n\n# Title\n')).toContain('<a href="#Title">Title</a>')
  })

  it('C2-I-101, C2-I-125: a citation shaped pair keeps its core reading', () => {
    const html = render('[@a]\n\n[@a]: /u\n')
    expect(html).toContain('[<span class="mention"><strong>@a</strong></span>]')
    expect(html).not.toContain('<a href="/u">')
  })

  it('C2-I-125: other bracket constructs take precedence', () => {
    const source = '[text](/direct) [text][other] [text][] [text]{.c} [^text] ^[text]\n\n[text]: /u\n[other]: /v\n'
    const paragraph = parse(source).children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') return
    expect(paragraph.children.filter((node) => node.type === 'link').map((node) => node.refForm)).toEqual([undefined, 'full', 'collapsed'])
    expect(paragraph.children.some((node) => node.type === 'span')).toBe(true)
    expect(paragraph.children.some((node) => node.type === 'footnote_ref')).toBe(true)
    expect(paragraph.children.some((node) => node.type === 'inline_footnote')).toBe(true)
  })

  it('C2-I-069, C2-I-078: malformed link tails and a following footnote leave the first pair as text', () => {
    const html = render('[text](/u v) [text][^n]\n\n[text]: /u\n[^n]: note\n')
    expect(html).toContain('[text](/u v)')
    expect(html).toContain('[text]<a')
  })

  it('C2-H-140: roundtrip carries the shortcut form on links and images', () => {
    const html = render('[text] ![text]\n\n[text]: /u\n', { roundtrip: true })
    expect(html).toContain('<a href="/u" data-carve-ref="text" data-carve-ref-shortcut>text</a>')
    expect(html).toContain('<img src="/u" alt="text" data-carve-ref="text" data-carve-ref-shortcut>')
  })

  it('C2-L-040, C2-W-075, C2-W-127: writing and normalization keep shortcut form', () => {
    const source = '[text]\n\n[text]: /u\n'
    expect(write(parse(source))).toBe(source)
    expect(format(source, { normalize: true })).toBe(source)
  })

  it('C2-L-049: the shortcut sidecar keeps the one bracket pair as rawRef', () => {
    const layout = parseWithLayout('[x]\n\n[x]: /u\n').layout
    expect(layout.nodes.find((entry) => entry.path === '/children/0/children/0')?.rawRef).toBe('[x]')
  })

  it('C2-W-088: a text pair that would become a defined shortcut is escaped', () => {
    const source = '\\[text]\n\n[text]: /u\n'
    expect(write(parse(source))).toBe(source)
    expect(parse(write(parse(source)))).toEqual(parse(source))
  })
})
