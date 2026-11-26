import { describe, expect, it } from 'vitest'
import { bbcodeHtml } from '../src/bbcode.ts'
import { importDocument } from '../src/index.ts'

function image(input: string, from: 'html' | 'bbcode'): unknown {
  const block = importDocument(input, { from }).document.children[0] as { children: unknown[] }
  return block.children[0]
}

function codes(input: string, from: 'html' | 'bbcode'): string[] {
  return importDocument(input, { from }).diagnostics.map((entry) => entry.code)
}

describe('carve#6804: the three alt states of an imported image', () => {
  it('C2-M-050: no alt attribute is unknown, an empty one decorative, a value alt text', () => {
    expect(image('<p><img src="x"></p>', 'html')).toEqual({ type: 'image', src: 'x' })
    expect(image('<p><img src="x" alt=""></p>', 'html')).toEqual({ type: 'image', src: 'x', decorative: true })
    expect(image('<p><img src="x" alt="t"></p>', 'html')).toEqual({ type: 'image', src: 'x', alt: 't' })
  })

  it('C2-W-011, C2-T-034: the import writes empty brackets and reports only the unknown alt, without refusing', () => {
    const unknown = importDocument('<p>a <img src="x"> b</p>', { from: 'html' })
    expect(unknown.source).toBe('a ![](x) b\n')
    expect(unknown.diagnostics.map((entry) => entry.code)).toEqual(['image-alt-unknown'])
    expect(codes('<p>a <img src="x" alt=""> b</p>', 'html')).toEqual([])
    const strict = importDocument('<p><img src="x"></p>', { from: 'html', strictLosses: true }).diagnostics
    expect(strict.map((entry) => [entry.code, entry.severity])).toEqual([['image-alt-unknown', 'error']])
  })

  it('a BBCode image without an alt value is unknown, on the tree route and the HTML route alike', () => {
    expect(image('[img]https://e.com/a.png[/img]', 'bbcode')).toEqual({ type: 'image', src: 'https://e.com/a.png' })
    expect(image('[img=t]https://e.com/a.png[/img]', 'bbcode')).toEqual({ type: 'image', src: 'https://e.com/a.png', alt: 't' })
    expect(bbcodeHtml('[img]https://e.com/a.png[/img]')).not.toContain('alt=')
  })
})
