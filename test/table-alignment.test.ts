import { describe, expect, test } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { run, type CliIO } from '../src/cli.js'

const canonical = '|= Name |= Score |= Note |\n| Ada | 9 | first try |\n| 山田太郎 | 10 | a longer note |\n+ | | that wraps |\n| Total | 19 | < |\n'
const aligned = '|= Name    |= Score |= Note         |\n| Ada      | 9      | first try     |\n| 山田太郎 | 10     | a longer note |\n+          |        | that wraps    |\n| Total    | 19     | <             |\n'

function io(source: string) {
  let output = ''
  const ports: CliIO = {
    readStdin: async () => source,
    write: value => { output += value },
    writeErr: () => {},
    readFile: () => source,
    writeFile: () => {},
  }
  return { ports, output: () => output }
}

describe('optional table alignment', () => {
  test('matches the shared wide-text shape and reaches a fixed point', () => {
    expect(carveToCarve(canonical, { alignTables: true })).toBe(aligned)
    expect(carveToCarve(aligned, { alignTables: true })).toBe(aligned)
    expect(carveToCarve(aligned)).toBe(canonical)
    expect(carveToHtml(aligned)).toBe(carveToHtml(canonical))
  })

  test('aligns an authored separator without changing dash counts', () => {
    const source = '| A | B |\n|---|---|\n| x | yy |\n'
    const expected = '| A | B  |\n|---|--- |\n| x | yy |\n'
    expect(carveToCarve(source, { alignTables: true })).toBe(expected)
    expect(carveToCarve(expected, { alignTables: true })).toBe(expected)
  })

  test('checks and prints the selected mode', async () => {
    const input = io(canonical)
    expect(await run(['fmt', '--align-tables'], input.ports)).toBe(0)
    expect(input.output()).toBe(aligned)
    expect(await run(['fmt', '--align-tables', '--check'], io(canonical).ports)).toBe(1)
    expect(await run(['fmt', '--align-tables', '--check'], io(aligned).ports)).toBe(0)
  })
})
