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
    expect(io.out).toContain('<!--')
  })

  it('refuses a target with no carrier', async () => {
    for (const target of ['--plain', '--ansi', '--carve']) {
      const io = makeIO('* a\n')
      expect(await run(['render', target, '--roundtrip'], io.io)).toBe(2)
      expect(io.err).toContain('--roundtrip applies to --html and --markdown output only')
    }
  })

  it('keeps --carry-markers Markdown-only', async () => {
    const io = makeIO('* a\n')
    expect(await run(['render', '--html', '--carry-markers'], io.io)).toBe(2)
    expect(io.err).toContain('--carry-markers applies to --markdown output only')
  })

  it('§13c: either flag enables the Markdown carriers, in either order', async () => {
    for (const args of [
      ['--carry-markers'],
      ['--roundtrip'],
      ['--carry-markers', '--roundtrip'],
      ['--roundtrip', '--carry-markers'],
    ]) {
      const io = makeIO('::: note\ntext\n:::\n')
      expect(await run(['render', '--markdown', ...args], io.io)).toBe(0)
      expect(io.out, args.join(' ')).toContain('<!--')
    }
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
