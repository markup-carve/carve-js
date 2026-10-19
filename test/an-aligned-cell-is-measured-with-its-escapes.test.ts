import { describe, expect, test } from 'vitest'
import { carveToCarve } from '../src/index.js'
import { run, type CliIO } from '../src/cli.js'

function io(source: string): CliIO {
  return {
    readStdin: async () => source,
    write: () => {},
    writeErr: () => {},
    readFile: () => source,
    writeFile: () => {},
  }
}

// carve-js#3240: `\ ` is written from a one-character placeholder, and the
// width was taken before it was written.
const cases: { name: string, canonical: string, aligned: string }[] = [
  {
    name: 'one non-breaking space escape',
    canonical: '| a\\ b | x |\n| ccc | `y|z` |\n',
    aligned: '| a\\ b | x     |\n| ccc  | `y|z` |\n',
  },
  {
    name: 'two non-breaking space escapes',
    canonical: '| a\\ \\ b |\n| cccccc |\n',
    aligned: '| a\\ \\ b |\n| cccccc |\n',
  },
  {
    name: 'an escape on a continuation line',
    canonical: '| a | b |\n+ c\\ d | e |\n',
    aligned: '| a    | b |\n+ c\\ d | e |\n',
  },
  {
    name: 'an escape in a quoted table',
    canonical: '> | a\\ b |\n> | c |\n',
    aligned: '> | a\\ b |\n> | c    |\n',
  },
  {
    name: 'a private-use character beside a code span',
    canonical: '| `ab` |\n| x |\n',
    aligned: '| `ab` |\n| x     |\n',
  },
]

describe('an aligned cell is measured with its escapes written', () => {
  for (const { name, canonical, aligned } of cases) {
    test(name, async () => {
      expect(carveToCarve(canonical)).toBe(canonical)
      expect(carveToCarve(canonical, { alignTables: true })).toBe(aligned)
      expect(carveToCarve(aligned, { alignTables: true })).toBe(aligned)
      expect(await run(['fmt', '--align-tables', '--check'], io(aligned))).toBe(0)
    })
  }
})
