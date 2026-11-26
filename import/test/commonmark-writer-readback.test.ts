import { describe, expect, it } from 'vitest'
import { parse } from '../../src/index.ts'
import { importDocument } from '../src/index.ts'

describe('CommonMark imports whose written source has a different inline reading', () => {
  it('keeps a link when its imported title crosses lines (CM-196)', () => {
    const input = "[foo]: /url '\ntitle\nline1\nline2\n'\n\n[foo]\n"
    const result = importDocument(input, { from: 'markdown' })
    expect(result.source).toBe('[foo](/url " title line1 line2 ")\n')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'field-unspellable', path: '/children/0/children/0/tooltip',
    }))
    const paragraph = parse(result.source).children[0]
    expect(paragraph?.type).toBe('paragraph')
    if (paragraph?.type !== 'paragraph') return
    expect(paragraph.children[0]).toMatchObject({ type: 'link', href: '/url', tooltip: ' title line1 line2 ' })
  })

  it('reads a literal angle bracket as text after writing it (CM-609)', () => {
    const result = importDocument('<m:abc>\n', { from: 'markdown' })
    expect(result.source).toBe('\\<m:abc>\n')
    expect(result.diagnostics).toEqual([])
    expect(parse(result.source).children[0]).toMatchObject({
      type: 'paragraph', children: [{ type: 'text', value: '<m:abc>' }],
    })
  })

  it('keeps an image when only its multiline title cannot be spelled', () => {
    const result = importDocument('<img src="/a" title="a&#10;b" alt="x">', { from: 'html' })
    expect(result.source).toBe('![x](/a "a b")\n')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'field-unspellable', path: '/children/0/children/0/tooltip',
    }))
    expect(parse(result.source).children[0]).toMatchObject({
      type: 'paragraph', children: [{ type: 'image', src: '/a', alt: 'x', tooltip: 'a b' }],
    })
  })
})
