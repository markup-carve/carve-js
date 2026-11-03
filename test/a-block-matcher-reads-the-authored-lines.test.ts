import { describe, expect, it } from 'vitest'
import { carveToHtml, type CarveExtension } from '../src/index.js'

// The root ownership walk rewrites lines it reads as a paragraph's lazy text
// (here `  ^ cap` below `@@wrap`). A matcher that owns those lines gets them as written.
const wrap: CarveExtension = {
  name: 'wrap',
  matchBlock(lines, start, ctx) {
    if (lines[start] !== '@@wrap') return null
    const end = lines.indexOf('@@end', start + 1)
    if (end < 0) return null
    return { node: { type: 'div', children: ctx.parseBlocks(lines.slice(start + 1, end).join('\n')) }, linesConsumed: end - start + 1 }
  },
}

describe('a block matcher', () => {
  for (const body of ['- ![a](/i)\n  ^ cap\n- c\n', '- | a |\n  ^ cap\n- c\n']) {
    it(`parses its lines like the document does: ${JSON.stringify(body)}`, () => {
      const html = carveToHtml(`@@wrap\n${body}@@end\n`, { extensions: [wrap] })
      expect(html).toBe(`<div>\n${carveToHtml(body).replace(/^/gm, '  ')}\n</div>`)
    })
  }

  it('sees the indentation the walk removed', () => {
    const seen: string[] = []
    const probe: CarveExtension = {
      name: 'probe',
      matchBlock(lines, start) {
        if (lines[start] !== '@@wrap') return null
        seen.push(...lines.slice(start + 1, start + 3))
        return { node: { type: 'thematic_break' }, linesConsumed: 3 }
      },
    }
    carveToHtml('@@wrap\n- a\n  ^ cap\n', { extensions: [probe] })
    expect(seen).toEqual(['- a', '  ^ cap'])
  })
})
