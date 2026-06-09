import { describe, it, expect } from 'vitest'
import { run, type CliIO } from '../src/cli.js'

/**
 * In-memory CliIO so the `carve` CLI can be exercised without touching the
 * real filesystem, stdin, or the process exit code.
 */
function makeIO(opts: { files?: Record<string, string>; stdin?: string } = {}) {
  const files: Record<string, string> = { ...opts.files }
  let out = ''
  let err = ''
  const io: CliIO = {
    readStdin: async () => opts.stdin ?? '',
    write: (s) => {
      out += s
    },
    writeErr: (s) => {
      err += s
    },
    readFile: (p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`)
      return files[p]!
    },
    writeFile: (p, c) => {
      files[p] = c
    },
  }
  return {
    io,
    files,
    get out() {
      return out
    },
    get err() {
      return err
    },
  }
}

describe('carve CLI — dispatch', () => {
  it('prints help on --help and exits 0', async () => {
    const t = makeIO()
    const code = await run(['--help'], t.io)
    expect(code).toBe(0)
    expect(t.out).toContain('carve fix')
  })

  it('errors (exit 2) on an unknown command', async () => {
    const t = makeIO()
    const code = await run(['frobnicate'], t.io)
    expect(code).toBe(2)
    expect(t.err).toContain("unknown command 'frobnicate'")
  })

  it('errors (exit 2) when invoked with no arguments', async () => {
    const t = makeIO()
    expect(await run([], t.io)).toBe(2)
  })
})

describe('carve fix — stdin mode', () => {
  it('fixes stdin and writes the result to stdout', async () => {
    const t = makeIO({ stdin: 'use _emphasis_ here' })
    const code = await run(['fix'], t.io)
    expect(code).toBe(0)
    expect(t.out).toBe('use /emphasis/ here')
  })

  it('--check on stdin exits 1 when input would change, prints nothing', async () => {
    const t = makeIO({ stdin: '**bold**' })
    const code = await run(['fix', '--check'], t.io)
    expect(code).toBe(1)
    expect(t.out).toBe('')
  })

  it('--check on clean stdin exits 0', async () => {
    const t = makeIO({ stdin: '/italic/ and *bold*' })
    expect(await run(['fix', '--check'], t.io)).toBe(0)
  })

  it('--write with no files is an error', async () => {
    const t = makeIO({ stdin: '_x_' })
    expect(await run(['fix', '--write'], t.io)).toBe(2)
    expect(t.err).toContain('--write requires file arguments')
  })
})

describe('carve fix — files mode', () => {
  it('default (no flag) is check: reports but does not modify, exit 1', async () => {
    const t = makeIO({ files: { 'a.crv': '_x_' } })
    const code = await run(['fix', 'a.crv'], t.io)
    expect(code).toBe(1)
    expect(t.files['a.crv']).toBe('_x_') // untouched
    expect(t.err).toContain('would fix a.crv')
  })

  it('--write rewrites the file in place and exits 0', async () => {
    const t = makeIO({ files: { 'a.crv': '_x_ and **y**' } })
    const code = await run(['fix', '--write', 'a.crv'], t.io)
    expect(code).toBe(0)
    expect(t.files['a.crv']).toBe('/x/ and *y*')
    expect(t.err).toContain('fixed a.crv (2 changes)')
  })

  it('--write leaves a clean file untouched', async () => {
    const t = makeIO({ files: { 'a.crv': 'plain text' } })
    expect(await run(['fix', '--write', 'a.crv'], t.io)).toBe(0)
    expect(t.files['a.crv']).toBe('plain text')
    expect(t.err).toBe('')
  })

  it('--stdout prints the fix without modifying the file', async () => {
    const t = makeIO({ files: { 'a.crv': '~~gone~~' } })
    const code = await run(['fix', '--stdout', 'a.crv'], t.io)
    expect(code).toBe(0)
    expect(t.out).toBe('~gone~')
    expect(t.files['a.crv']).toBe('~~gone~~')
  })

  it('reports a missing file and exits 2', async () => {
    const t = makeIO()
    expect(await run(['fix', '--write', 'nope.crv'], t.io)).toBe(2)
    expect(t.err).toContain('cannot read nope.crv')
  })

  it('rejects more than one mode flag', async () => {
    const t = makeIO({ files: { 'a.crv': '_x_' } })
    expect(await run(['fix', '--write', '--check', 'a.crv'], t.io)).toBe(2)
  })

  it('rejects --stdout with multiple files', async () => {
    const t = makeIO({ files: { 'a.crv': '_x_', 'b.crv': '_y_' } })
    expect(await run(['fix', '--stdout', 'a.crv', 'b.crv'], t.io)).toBe(2)
  })
})

describe('carve lint', () => {
  it('reports a broken cross-reference and exits 1', async () => {
    const t = makeIO({ stdin: '# A\n\nSee </#ghost>.' })
    const code = await run(['lint'], t.io)
    expect(code).toBe(1)
    expect(t.out).toContain('broken-crossref')
    expect(t.out).toContain('<stdin>:3:')
  })

  it('reports both collision and semantic warnings together', async () => {
    const t = makeIO({ stdin: '# A\n\n_em_ and </#ghost>' })
    expect(await run(['lint'], t.io)).toBe(1)
    expect(t.out).toContain('djot-emphasis-underscore')
    expect(t.out).toContain('broken-crossref')
  })

  it('exits 0 on a clean document', async () => {
    const t = makeIO({ stdin: '# Intro\n\nSee </#intro>.' })
    expect(await run(['lint'], t.io)).toBe(0)
    expect(t.out).toBe('')
  })

  it('lints files and prefixes findings with the filename', async () => {
    const t = makeIO({ files: { 'a.crv': '# A\n\n## A' } })
    expect(await run(['lint', 'a.crv'], t.io)).toBe(1)
    expect(t.out).toContain('a.crv:3:1 duplicate-heading-id')
  })

  it('reports a missing file and exits 2', async () => {
    const t = makeIO()
    expect(await run(['lint', 'nope.crv'], t.io)).toBe(2)
    expect(t.err).toContain('cannot read nope.crv')
  })
})

describe('carve fix — overlapping (manual-review) collisions', () => {
  it('reports skipped overlaps on stderr and leaves them in output', async () => {
    const t = makeIO({ stdin: '**_x_**' })
    const code = await run(['fix'], t.io)
    expect(code).toBe(0)
    expect(t.out).toBe('**_x_**') // nothing auto-applied
    expect(t.err).toContain('overlapping collision')
  })

  it('--check fails (exit 1) when a file has only manual-review collisions', async () => {
    const t = makeIO({ files: { 'a.crv': '**_x_**' } })
    // applied is empty, but skipped is non-empty -> not clean.
    expect(await run(['fix', 'a.crv'], t.io)).toBe(1)
  })
})
