import { describe, expect, it } from 'vitest'
import { carveToHtml, type CarveExtension } from '../src/index.js'

describe('definition collection follows verse ownership', () => {
  it('registers a definition after a closed verse in a list item', () => {
    const html = carveToHtml('- ::: |\n  verse\n  :::\n\n  [r]: /target\n\n[t][r]\n')
    expect(html).toContain('href="/target"')
  })

  it('keeps definitions literal after a lazy list continuation', () => {
    const html = carveToHtml('- ::: |\n  verse\nlazy\n  [r]: /hidden\n  :::\n\n[t][r]\n')
    expect(html).toContain('[r]: /hidden')
    expect(html).not.toContain('href="/hidden"')
  })

  it('keeps a colon closer inside a closed comment span literal', () => {
    const html = carveToHtml('::: |\n%%%\n:::\n[r]: /target\n%%%\n\n[t][r]\n')
    expect(html).toContain('[r]: /target')
    expect(html).not.toContain('href="/target"')
  })
  it('keeps an attached code span and its colon line inside verse', () => {
    const html = carveToHtml('> ::: |\n> verse\n+\n```\n:::\n```\n> [r]: /hidden\n> :::\n\n[t][r]\n')
    expect(html).toContain('[r]: /hidden')
    expect(html).not.toContain('href="/hidden"')
    expect(html).not.toContain('\uE005')
  })

  it('does not repeat inline matchers during verse ownership discovery', () => {
    const calls: string[] = []
    const extension: CarveExtension = {
      name: 'inline-counter',
      matchInline(text, pos) {
        if (text.slice(pos).startsWith('§token')) {
          calls.push(text)
          return { end: pos + 6, node: { type: 'text', value: 'matched' } }
        }
        return null
      },
    }
    const html = carveToHtml('§token\n\n::: |\n[r]: /hidden\n:::\n\n[t][r]\n', { extensions: [extension] })
    expect(html).toContain('matched')
    expect(html).not.toContain('href="/hidden"')
    expect(calls).toEqual(['§token'])
  })

  it('keeps inline extensions available to block matcher context requests', () => {
    const values: string[] = []
    const extension: CarveExtension = {
      name: 'context-counter',
      matchInline(text, pos) {
        return text.slice(pos).startsWith('§token')
          ? { end: pos + 6, node: { type: 'text', value: 'matched' } }
          : null
      },
      matchBlock(lines, start, context) {
        if (lines[start] !== '!custom') return null
        expect(context.parseBlocks('§token')).toMatchObject([{ type: 'paragraph', children: [{ type: 'text', value: 'matched' }] }])
        const children = context.parseInlines('§token')
        values.push(children.map((node) => node.type === 'text' ? node.value : '').join(''))
        return { linesConsumed: 1, node: { type: 'paragraph', children } }
      },
    }
    const html = carveToHtml('!custom\n\n::: |\n[r]: /hidden\n:::\n\n[t][r]\n', { extensions: [extension] })
    expect(html).toContain('matched')
    expect(values.length).toBeGreaterThan(0)
    expect(values.every((value) => value === 'matched')).toBe(true)
  })

  it('does not assign synthetic extension fragment lines to the document', () => {
    const extension: CarveExtension = {
      name: 'synthetic-verse',
      matchBlock(lines, start, context) {
        if (lines[start] !== '!wrap') return null
        const node = context.parseBlocks('::: |\nx\n:::')[0]!
        return { linesConsumed: 1, node }
      },
    }
    const html = carveToHtml('!wrap\n[r]: /url\n\n::: |\nv\n:::\n\n[t][r]\n', { extensions: [extension] })
    expect(html).toContain('href="/url"')
  })

})
