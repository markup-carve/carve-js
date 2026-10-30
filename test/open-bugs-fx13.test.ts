import { describe, expect, it } from 'vitest'
import { run, type CliIO } from '../src/cli.js'
import { carveToHtml, lintCarve, migrateHtml, parse, renderHtml } from '../src/index.js'

describe('first-block item ownership', () => {
  it('attaches a follower at the inner marker column to the inner item', () => {
    expect(renderHtml(parse('- - +\n  x\nplain\n'))).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>x\nplain</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('refuses a block at an item content column with a warning', () => {
    expect(renderHtml(parse('- +\n  x\n'))).toBe('<ul>\n  <li>+\nx</li>\n</ul>')
    expect(lintCarve('- +\n  x\n').filter(w => w.rule === 'continuation-marker-refused')).toHaveLength(1)
  })
})

describe('roundtrip abbreviation definitions', () => {
  it('preserves duplicate source lines and uses the last expansion', () => {
    const source = '*[A]: a\n*[A]: b\n\nA\n'
    const html = carveToHtml(source, { roundtrip: true })
    expect(html).toContain('<abbr title="b">A</abbr>')
    expect(html).toContain('<template data-carve-abbreviations>*[A]: a\n*[A]: b</template>')
    expect(migrateHtml(html, { mode: 'roundtrip' }).value).toContain('*[A]: a\n\n*[A]: b')
  })
})

describe('CLI error categories', () => {
  const invoke = async (args: string[], stdin = '') => {
    let err = ''
    const io: CliIO = {
      readStdin: async () => stdin,
      readFile: () => { throw new Error('ENOENT') },
      writeFile: () => {},
      write: () => {},
      writeErr: s => { err += s },
    }
    return { code: await run(args, io), err }
  }

  it.each([
    [['--unknown'], '', 'usage'],
    [['migrate', '--from', 'nope'], '', 'usage'],
    [['--from-json'], '{', 'ast-json-invalid'],
    [['missing.crv'], '', 'input-unreadable'],
  ] as const)('%j reports %s', async (args, stdin, category) => {
    const result = await invoke([...args], stdin)
    expect(result.code).toBe(2)
    expect(result.err).toMatch(new RegExp(`^carve\\[${category}\\]: `))
  })
})
