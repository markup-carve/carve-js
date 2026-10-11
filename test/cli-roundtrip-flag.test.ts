import { describe, expect, it } from 'vitest'
import { run, type CliIO } from '../src/cli.js'

function makeIO(stdin: string) {
  let out = ''
  let err = ''
  const io: CliIO = {
    readStdin: async () => stdin,
    write: (s) => { out += s },
    writeErr: (s) => { err += s },
    readFile: () => { throw new Error('ENOENT') },
    writeFile: () => {},
  }
  return { io, get out() { return out }, get err() { return err } }
}

describe('carve render --roundtrip (PART 10 §13)', () => {
  it('writes the HTML carriers', async () => {
    const io = makeIO('* a\n')
    expect(await run(['render', '--html', '--roundtrip'], io.io)).toBe(0)
    expect(io.out).toContain('data-marker="*"')
  })

  it('is off by default', async () => {
    const io = makeIO('* a\n')
    expect(await run(['render', '--html'], io.io)).toBe(0)
    expect(io.out).not.toContain('data-marker')
  })

  it('selects the Markdown container carriers', async () => {
    const io = makeIO('::: note\ntext\n:::\n')
    expect(await run(['render', '--markdown', '--roundtrip'], io.io)).toBe(0)
    expect(io.out).toContain('<!-- carve: ::: note -->')
  })

  it('writes Markdown container carriers from an encoded AST', async () => {
    const encode = makeIO('::: note\ntext\n:::\n')
    expect(await run(['render', '--json'], encode.io)).toBe(0)
    const decode = makeIO(encode.out)
    expect(await run(['render', '--from-json', '--markdown', '--roundtrip'], decode.io)).toBe(0)
    expect(decode.out).toContain('<!-- carve: ::: note -->')
  })

  it('refuses a target with no carrier', async () => {
    for (const target of ['--plain', '--ansi', '--carve', '--json']) {
      const io = makeIO('* a\n')
      expect(await run(['render', target, '--roundtrip'], io.io)).toBe(2)
      expect(io.err).toContain('--roundtrip applies to --html and --markdown output only')
    }
  })

  it('rejects the removed Markdown carrier flag as unknown', async () => {
    const io = makeIO('::: note\ntext\n:::\n')
    const flag = '--carry-markers'
    expect(await run(['render', '--markdown', flag], io.io)).toBe(2)
    expect(io.err).toContain(`Unknown option '${flag}'`)
  })

  it('names the flag in the help text', async () => {
    const io = makeIO('')
    await run(['render', '--help'], io.io)
    expect(io.out + io.err).toContain('--roundtrip')
  })

  it('allows the collision loss code through --allow-loss', async () => {
    const io = makeIO('{data-marker=Z}\n* a\n')
    expect(await run([
      'render', '--html', '--roundtrip', '--strict-losses',
      '--allow-loss', 'carrier-attribute-dropped',
    ], io.io)).toBe(0)
    expect(io.err).toBe('')
  })

  it('reports the collision as a strict loss without the allowance', async () => {
    const io = makeIO('{data-marker=Z}\n* a\n')
    expect(await run(['render', '--html', '--roundtrip', '--strict-losses'], io.io)).toBe(1)
    expect(io.err).toContain('data-marker')
  })
})
