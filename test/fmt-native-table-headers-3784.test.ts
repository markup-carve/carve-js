import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { run, type CliIO } from '../src/cli.js'

const source = (align: string[], body: string[] = []): string => {
  const heading = `| ${align.map((_, i) => `H${i}`).join(' | ')} |`
  const separator = `|${align.join('|')}|`
  return `${heading}\n${separator}\n${body.map(row => `${row}\n`).join('')}`
}

describe('fmt writes native table headers (#3784)', () => {
  it('marks a GFM separator as noncanonical in the CLI', async () => {
    const input = source([':---:'])
    const output = carveToCarve(input)
    const io = (text: string): CliIO => ({
      readStdin: async () => text,
      write: () => {},
      writeErr: () => {},
      readFile: () => text,
      writeFile: () => {},
    })
    expect(await run(['fmt', '--check'], io(input))).toBe(1)
    expect(await run(['fmt', '--check'], io(output))).toBe(0)
  })

  it.each([
    ['---', '|= H0 |'],
    [':---', '|=< H0 |'],
    ['---:', '|=> H0 |'],
    [':---:', '|=~ H0 |'],
  ])('carries separator alignment %s onto the header', (separator, header) => {
    const input = source([separator], ['| data |'])
    const output = carveToCarve(input)
    expect(output).toBe(`${header}\n| data |\n`)
    expect(carveToHtml(output)).toBe(carveToHtml(input))
    expect(carveToCarve(output)).toBe(output)
    expect(carveToCarve(input, { preserveTableSeparators: true })).toBe(input)
  })

  it('handles a header-only table and a body row wider than the delimiter', () => {
    for (const input of [source(['---:']), source([':---'], ['| a | b |'])]) {
      const output = carveToCarve(input)
      expect(output).not.toContain('|---')
      expect(carveToHtml(output)).toBe(carveToHtml(input))
      expect(carveToCarve(output)).toBe(output)
      expect(carveToCarve(input, { preserveTableSeparators: true })).toBe(input)
    }
  })

  it('keeps 1,000 generated tables stable across alignment, width, and siblings', () => {
    const separators = ['---', ':---', '---:', ':---:']
    for (let n = 0; n < 1000; n++) {
      const columns = 1 + n % 4
      const align = Array.from({ length: columns }, (_, i) => separators[(Math.floor(n / 4) + i) % 4]!)
      const heading = `| ${align.map((_, i) => `${' '.repeat((n + i) % 2)}H${i}`).join(' | ')} |`
      const delimiter = `|${align.join('|')}|`
      const width = n % 11 === 0 ? columns + 1 : columns
      const body = n % 7 === 0 ? '' : `| ${Array.from({ length: width }, (_, i) => `B${i}`).join(' | ')} |\n`
      const table = `${heading}\n${delimiter}\n${body}`
      const host = n % 5
      const hosted = host === 1 || host === 2
        ? table.trimEnd().split('\n').map(line => `${'> '.repeat(host)}${line}\n`).join('')
        : host === 3 ? `- item\n+\n${table}`
          : host === 4 ? `::: note\n${table}:::\n` : table
      const prefix = n % 3 === 0 ? 'Before\n\n' : ''
      const suffix = n % 3 === 1 ? '\nAfter\n' : ''
      const input = `${prefix}${hosted}${suffix}`
      const formatted = carveToCarve(input)
      expect(formatted, `variant ${n}`).not.toContain(delimiter)
      expect(carveToCarve(formatted), `variant ${n}`).toBe(formatted)
      expect(carveToHtml(formatted), `variant ${n}`).toBe(carveToHtml(input))
      expect(carveToCarve(input, { preserveTableSeparators: true }), `variant ${n}`).toContain(delimiter)
      expect(carveToHtml(formatted), `variant ${n}`).toContain('<table>')
    }
  })
})
