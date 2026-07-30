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

  it('treats a non-subcommand first arg as a file to render (exit 2 if missing)', async () => {
    const t = makeIO()
    const code = await run(['frobnicate'], t.io)
    expect(code).toBe(2)
    expect(t.err).toContain('cannot read frobnicate')
  })

  it('renders stdin (HTML) when invoked with no arguments', async () => {
    const t = makeIO({ stdin: '# Hi\n' })
    expect(await run([], t.io)).toBe(0)
    expect(t.out).toContain('<h1>Hi</h1>')
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
    const t = makeIO({ stdin: '# A\n\n**strong** and </#ghost>' })
    expect(await run(['lint'], t.io)).toBe(1)
    expect(t.out).toContain('markdown-strong-double-star')
    expect(t.out).toContain('broken-crossref')
  })

  it('hides djot-shift constructs by default (valid Carve)', async () => {
    const t = makeIO({ stdin: '_x_ and ~y~ and {=z=}' })
    expect(await run(['lint'], t.io)).toBe(0)
    expect(t.out).toBe('')
  })

  it('flags djot-shift constructs with --from-djot', async () => {
    const t = makeIO({ stdin: '_x_' })
    expect(await run(['lint', '--from-djot'], t.io)).toBe(1)
    expect(t.out).toContain('djot-emphasis-underscore')
  })

  it('still flags carve-breakage without --from-djot', async () => {
    const t = makeIO({ stdin: '+ item' })
    expect(await run(['lint'], t.io)).toBe(1)
    expect(t.out).toContain('djot-plus-bullet')
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

describe('carve fix — collisions', () => {
  it('composes nested collisions (**_x_** -> */x/*)', async () => {
    const t = makeIO({ stdin: '**_x_**' })
    const code = await run(['fix'], t.io)
    expect(code).toBe(0)
    expect(t.out).toBe('*/x/*')
  })

  it('reports crossing collisions on stderr and leaves them in output', async () => {
    const t = makeIO({ stdin: '**_x**_' })
    const code = await run(['fix'], t.io)
    expect(code).toBe(0)
    expect(t.out).toBe('**_x**_') // ambiguous, nothing auto-applied
    expect(t.err).toContain('overlapping collision')
  })

  it('--check fails (exit 1) when a file has only crossing collisions', async () => {
    const t = makeIO({ files: { 'a.crv': '**_x**_' } })
    // applied is empty, but skipped is non-empty -> not clean.
    expect(await run(['fix', 'a.crv'], t.io)).toBe(1)
  })
})

describe('carve render', () => {
  const SRC = '# Hi\n\n_em_ *strong* `code`\n'
  const RAW_HTML = '```=html\n<script>alert(1)</script>\n```\n'

  it('renders HTML by default from stdin', async () => {
    const t = makeIO({ stdin: SRC })
    expect(await run(['render'], t.io)).toBe(0)
    expect(t.out).toContain('<h1>Hi</h1>')
    expect(t.out).toContain('<strong>strong</strong>')
  })

  it('renders Markdown with --markdown', async () => {
    const t = makeIO({ stdin: SRC })
    expect(await run(['render', '--markdown'], t.io)).toBe(0)
    expect(t.out).toContain('# Hi')
    expect(t.out).toContain('**strong**')
  })

  it('renders plain text with --plain', async () => {
    const t = makeIO({ stdin: SRC })
    expect(await run(['render', '--plain'], t.io)).toBe(0)
    expect(t.out).toContain('Hi')
    expect(t.out).not.toContain('<h1>')
    expect(t.out).not.toContain('**')
  })

  it('renders ANSI escape codes with --ansi', async () => {
    const t = makeIO({ stdin: SRC })
    expect(await run(['render', '--ansi'], t.io)).toBe(0)
    expect(t.out).toContain('[') // an SGR escape was emitted
  })

  it('reads a file argument', async () => {
    const t = makeIO({ files: { 'a.crv': SRC } })
    expect(await run(['render', '--markdown', 'a.crv'], t.io)).toBe(0)
    expect(t.out).toContain('# Hi')
  })

  it('rejects more than one format flag', async () => {
    const t = makeIO({ stdin: SRC })
    expect(await run(['render', '--ansi', '--markdown'], t.io)).toBe(2)
    expect(t.err).toContain('choose at most one')
  })

  it('rejects multiple input files', async () => {
    const t = makeIO({ files: { 'a.crv': SRC, 'b.crv': SRC } })
    expect(await run(['render', 'a.crv', 'b.crv'], t.io)).toBe(2)
  })

  it('reports an unreadable file', async () => {
    const t = makeIO()
    expect(await run(['render', 'missing.crv'], t.io)).toBe(2)
    expect(t.err).toContain('cannot read')
  })

  it('renders without the render subcommand (carve --ansi)', async () => {
    const t = makeIO({ stdin: SRC })
    expect(await run(['--ansi'], t.io)).toBe(0)
    expect(t.out).toContain('[') // SGR escape emitted
  })

  it('renders a bare file argument as HTML by default', async () => {
    const t = makeIO({ files: { 'a.crv': SRC } })
    expect(await run(['a.crv'], t.io)).toBe(0)
    expect(t.out).toContain('<h1>Hi</h1>')
  })

  it('renders --markdown without the subcommand', async () => {
    const t = makeIO({ stdin: SRC })
    expect(await run(['--markdown'], t.io)).toBe(0)
    expect(t.out).toContain('# Hi')
  })

  it('--no-raw-html escapes raw HTML blocks on the HTML target', async () => {
    const t = makeIO({ stdin: RAW_HTML })
    expect(await run(['render', '--no-raw-html'], t.io)).toBe(0)
    expect(t.out).toContain('&lt;script&gt;')
    expect(t.out).not.toContain('<script>')
  })

  it('emits raw HTML blocks by default on the HTML target', async () => {
    const t = makeIO({ stdin: RAW_HTML })
    expect(await run(['render'], t.io)).toBe(0)
    expect(t.out).toContain('<script>alert(1)</script>')
  })

  it('--safe is an alias for --no-raw-html', async () => {
    const safe = makeIO({ stdin: RAW_HTML })
    const noRawHtml = makeIO({ stdin: RAW_HTML })
    expect(await run(['render', '--safe'], safe.io)).toBe(0)
    expect(await run(['render', '--no-raw-html'], noRawHtml.io)).toBe(0)
    expect(safe.out).toBe(noRawHtml.out)
    // Equality alone would also hold if both flags were ignored.
    expect(safe.out).toContain('&lt;script&gt;')
  })

  it('accepts the carve-rs format aliases --md and --plain-text', async () => {
    const md = makeIO({ stdin: SRC })
    const markdown = makeIO({ stdin: SRC })
    expect(await run(['--md'], md.io)).toBe(0)
    expect(await run(['--markdown'], markdown.io)).toBe(0)
    expect(md.out).toBe(markdown.out)
    expect(md.out).toContain('# Hi')

    const plainText = makeIO({ stdin: SRC })
    const plain = makeIO({ stdin: SRC })
    expect(await run(['--plain-text'], plainText.io)).toBe(0)
    expect(await run(['--plain'], plain.io)).toBe(0)
    expect(plainText.out).toBe(plain.out)
    expect(plainText.out).not.toContain('#')
  })

  it('counts an alias and its canonical flag as one format, but still rejects two', async () => {
    const same = makeIO({ stdin: SRC })
    expect(await run(['--md', '--markdown'], same.io)).toBe(0)

    const two = makeIO({ stdin: SRC })
    expect(await run(['--md', '--plain'], two.io)).toBe(2)
    expect(two.err).toContain('choose at most one')
  })

  it('--profile comment filters headings', async () => {
    const t = makeIO({ stdin: '# Heading\n' })
    expect(await run(['render', '--profile', 'comment'], t.io)).toBe(0)
    expect(t.out).not.toContain('<h1>')
  })

  it("rejects input over a profile's maximum length like any other profile rejection", async () => {
    const t = makeIO({ stdin: `${'x'.repeat(20_000)}\n` })
    expect(await run(['render', '--profile', 'minimal'], t.io)).toBe(2)
    expect(t.err).toContain('carve render:')
    expect(t.err).toContain('maximum length of 10000 bytes')
  })

  it('leaves input under the cap alone, so the check above can fail', async () => {
    const t = makeIO({ stdin: `${'x'.repeat(20)}\n` })
    expect(await run(['render', '--profile', 'minimal'], t.io)).toBe(0)
    expect(t.err).toBe('')
  })

  it('rejects an unknown profile', async () => {
    const t = makeIO({ stdin: SRC })
    expect(await run(['render', '--profile', 'nope'], t.io)).toBe(2)
    expect(t.err).toContain('expected full, article, comment or minimal')
  })

  it('rejects --profile-base-host without --profile', async () => {
    const t = makeIO({ stdin: SRC })
    expect(await run(['render', '--profile-base-host', 'example.com'], t.io)).toBe(2)
    expect(t.err).toContain('--profile-base-host requires --profile')
  })

  it('rejects profiles with --carve and explains why', async () => {
    const t = makeIO({ stdin: '# Heading\n' })
    expect(await run(['render', '--profile', 'comment', '--carve'], t.io)).toBe(2)
    expect(t.err).toContain('formats what the author wrote')
    expect(t.err).toContain('filtered output')
  })
})

describe('carve CLI — stamp modes', () => {
  const OLD = 'text\n\n%% carve-version: 0.0.9; generated-by: carve-js 0.0.9\n'

  it('--stamp-info reports the marker and exits 0', async () => {
    const t = makeIO({ stdin: OLD })

    expect(await run(['--stamp-info'], t.io)).toBe(0)
    expect(t.out).toContain('carve-version: 0.0.9')
    expect(t.out).toContain('generated-by: carve-js 0.0.9')
  })

  it('--stamp-info says so when there is no marker', async () => {
    const t = makeIO({ stdin: 'text\n' })

    expect(await run(['--stamp-info'], t.io)).toBe(0)
    expect(t.out).toContain('unstamped')
  })

  it('--stamp-check exits 1 for an older or unknown document', async () => {
    const older = makeIO({ stdin: OLD })
    expect(await run(['--stamp-check'], older.io)).toBe(1)
    expect(older.err).toContain('[behavior]')

    const unstamped = makeIO({ stdin: 'text\n' })
    expect(await run(['--stamp-check'], unstamped.io)).toBe(1)
  })

  it('--stamp-check exits 0 for a current document', async () => {
    const { SPEC_VERSION } = await import('../src/version.js')
    const t = makeIO({ stdin: `text\n\n%% carve-version: ${SPEC_VERSION}; generated-by: x\n` })

    expect(await run(['--stamp-check'], t.io)).toBe(0)
  })
})
