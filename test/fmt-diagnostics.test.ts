import { describe, expect, it } from 'vitest'
import { run, type CliIO } from '../src/cli.js'

function formatterIO(source: string) {
  let output = ''
  let errors = ''
  const io: CliIO = {
    readStdin: async () => source,
    readFile: () => source,
    writeFile: () => { throw new Error('check mode wrote a file') },
    write: value => { output += value },
    writeErr: value => { errors += value },
  }
  return { io, output: () => output, errors: () => errors }
}

describe('formatter diagnostics', () => {
  const source = '# Title   \n'

  it('locates the first changed line in check mode', async () => {
    const state = formatterIO(source)
    expect(await run(['fmt', '--check', 'example.crv'], state.io)).toBe(1)
    expect(state.errors()).toContain('example.crv:1\n- # Title   \n+ # Title')
    expect(state.output()).toBe('')
  })

  it('writes a unified source diff', async () => {
    const state = formatterIO(source)
    expect(await run(['fmt', '--diff', 'example.crv'], state.io)).toBe(1)
    expect(state.output()).toMatch(/^--- a\/example\.crv\n\+\+\+ b\/example\.crv\n@@ -1,1 \+1,1 @@\n/)
    expect(state.output()).toContain('-# Title   \n+# Title\n')
    expect(state.errors()).toBe('')
  })

  it('keeps unchanged neighboring lines as diff context', async () => {
    const state = formatterIO('# First\n\ntext   \n\n# Last\n')
    expect(await run(['fmt', '--diff', 'example.crv'], state.io)).toBe(1)
    expect(state.output()).toContain(' # First\n \n-text   \n+text\n \n # Last\n')
  })

  it('keeps the success status for canonical input', async () => {
    const state = formatterIO('# Title\n')
    expect(await run(['fmt', '--check', 'example.crv'], state.io)).toBe(0)
    expect(state.errors()).toBe('')
  })
})
