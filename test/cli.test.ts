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

describe('carve migrate — HTML import', () => {
  it('writes Carve plus a machine-readable loss report', async () => {
    const t = makeIO({ stdin: '<p onclick="x()">Hello</p>' })
    const code = await run(['migrate', '--from', 'html', '--report', 'report.json', '--check-loss'], t.io)
    expect(code).toBe(1)
    expect(t.out).toBe('Hello\n')
    expect(JSON.parse(t.files['report.json']!)).toMatchObject({ mode: 'safe', diagnostics: [{ code: 'attribute-dropped' }] })
  })
})

describe('carve migrate — the other importers', () => {
  it.each([
    ['markdown', '**bold** and _em_\n'],
    ['md', '**bold** and _em_\n'],
  ])('converts Markdown with --from %s', async (from, stdin) => {
    const t = makeIO({ stdin })
    const code = await run(['migrate', '--from', from], t.io)
    expect(code).toBe(0)
    expect(t.err).toBe('')
    expect(t.out).toContain('*bold* and /em/')
  })

  it('converts BBCode with --from bbcode', async () => {
    const t = makeIO({ stdin: '[b]bold[/b] and [i]em[/i]\n' })
    const code = await run(['migrate', '--from', 'bbcode'], t.io)
    expect(code).toBe(0)
    expect(t.out).toContain('*bold* and /em/')
  })

  it('reads the input file rather than stdin when one is named', async () => {
    const t = makeIO({ files: { 'in.md': '# Title\n' } })
    const code = await run(['migrate', '--from', 'markdown', 'in.md'], t.io)
    expect(code).toBe(0)
    expect(t.out).toContain('# Title')
  })

  // Djot has no importer here yet, only the `fix` linter, so it must fail as
  // an unknown format rather than look supported.
  it.each(['djot', 'rst'])('rejects the unsupported source format %s', async (from) => {
    const t = makeIO({ stdin: 'x' })
    const code = await run(['migrate', '--from', from], t.io)
    expect(code).toBe(2)
    expect(t.err).toContain(`unknown source format ${from}`)
  })

  it('names every supported format when --from is missing', async () => {
    const t = makeIO({ stdin: 'x' })
    const code = await run(['migrate'], t.io)
    expect(code).toBe(2)
    expect(t.err).toContain('html, markdown or bbcode')
  })

  /**
   * The loss report belongs to the HTML importer alone, so a Markdown
   * migration ignores its options instead of validating or honoring them.
   */
  it('ignores the HTML-only options for the other formats', async () => {
    const t = makeIO({ stdin: '**bold**\n' })
    const code = await run(
      ['migrate', '--from', 'markdown', '--mode', 'nonsense', '--check-loss', '--report', 'report.json'],
      t.io,
    )
    expect(code).toBe(0)
    expect(t.out).toBe('*bold*\n')
    expect(t.files['report.json']).toBeUndefined()
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

describe('carve lint --portable', () => {
  it('reports blockquote marker spacing without the flag', async () => {
    const t = makeIO({ files: { 'q.crv': '>quote\n' } })
    expect(await run(['lint', 'q.crv'], t.io)).toBe(1)
    expect(t.out).toContain('blockquote-marker-without-space')
  })

  it('keeps the deprecated flag as a compatibility no-op', async () => {
    const t = makeIO({ files: { 'q.crv': '>quote\n' } })
    expect(await run(['lint', '--portable', 'q.crv'], t.io)).toBe(1)
    expect(t.out).toContain('blockquote-marker-without-space')
  })

  it('composes with --from-djot', async () => {
    const t = makeIO({ files: { 'q.crv': '>quote\n\n_x_\n' } })
    expect(await run(['lint', '--portable', '--from-djot', 'q.crv'], t.io)).toBe(1)
    expect(t.out).toContain('blockquote-marker-without-space')
    expect(t.out).toContain('djot-emphasis-underscore')
  })

  it('documents the flag in help', async () => {
    const t = makeIO()
    await run(['lint', '--help'], t.io)
    expect(t.out).toContain('--portable')
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

  it('the stamp modes render nothing, whatever format flag is passed', async () => {
    // They answer a question ABOUT the document. If they also rendered, piping
    // --stamp-check into a file would silently write markup.
    for (const format of [[], ['--markdown'], ['--ansi'], ['--carve']]) {
      const t = makeIO({ stdin: '# Heading\n\n%% carve-version: 0.0.9; generated-by: x\n' })
      await run([...format, '--stamp-info'], t.io)
      expect(t.out).not.toContain('<h1')
      expect(t.out).not.toContain('Heading')
      expect(t.out).toContain('carve-version: 0.0.9')
    }
  })
})

describe('carve CLI — --json / --from-json (PART 12 exchange format)', () => {
  it('renders the AST as JSON with positions', async () => {
    const t = makeIO({ stdin: '# Title\n' })
    const code = await run(['--json'], t.io)
    expect(code).toBe(0)
    const json = JSON.parse(t.out)
    expect(json.type).toBe('document')
    expect(Object.keys(json).sort()).toEqual(['children', 'srcByteLength', 'type'])
    expect(json.children[0]).toMatchObject({ type: 'heading', level: 1 })
    expect(json.children[0].pos.startLine).toBe(1)
  })

  it('accepts --ast, carve-php\'s spelling of the same flag', async () => {
    const t = makeIO({ stdin: '# Title\n' })
    expect(await run(['--ast'], t.io)).toBe(0)
    expect(JSON.parse(t.out).type).toBe('document')
  })

  it('refuses a second output format', async () => {
    const t = makeIO({ stdin: '# T\n' })
    expect(await run(['--json', '--markdown'], t.io)).toBe(2)
    expect(t.err).toContain('choose at most one')
  })

  it('round trips source -> JSON -> HTML identically to rendering it directly', async () => {
    const source = '# H\n\nP[^a] with /em/\n\n- a\n- b\n\n[^a]: note\n'
    const direct = makeIO({ stdin: source })
    await run(['--html'], direct.io)

    const encode = makeIO({ stdin: source })
    await run(['--json'], encode.io)
    const decode = makeIO({ stdin: encode.out })
    const code = await run(['--from-json', '--html'], decode.io)

    expect(code).toBe(0)
    expect(decode.out).toBe(direct.out)
  })

  it('round trips the tree itself: --json then --from-json --json is identity', async () => {
    // PART 12 §6, from the command line.
    const first = makeIO({ stdin: '---\na: 1\n---\n\n> q[^x]\n\n[^x]: d\n' })
    await run(['--json'], first.io)
    const second = makeIO({ stdin: first.out })
    await run(['--from-json', '--json'], second.io)
    expect(JSON.parse(second.out)).toEqual(JSON.parse(first.out))
  })

  it('reports malformed JSON as a user error, not a crash', async () => {
    const t = makeIO({ stdin: 'not json at all\n' })
    expect(await run(['--from-json'], t.io)).toBe(2)
    expect(t.err).toContain('not valid JSON')
  })

  it('rejects JSON that is not a Carve AST', async () => {
    const t = makeIO({ stdin: '{"hello":"world"}' })
    expect(await run(['--from-json'], t.io)).toBe(2)
    expect(t.err).toContain("type 'document'")
  })

  it('applies a profile to a decoded tree', async () => {
    // Nothing parsed here, so the profile has to be applied to the tree itself -
    // a decoded document must not be a way around the restriction.
    const encode = makeIO({ stdin: '# H\n\n`code`\n' })
    await run(['--json'], encode.io)
    const decode = makeIO({ stdin: encode.out })
    expect(await run(['--from-json', '--html', '--profile', 'minimal'], decode.io)).toBe(0)
    expect(decode.out).not.toContain('<h1')
  })

  it('escapes raw HTML under --safe when reading a tree', async () => {
    const encode = makeIO({ stdin: '```=html\n<script>alert(1)</script>\n```\n' })
    await run(['--json'], encode.io)
    const decode = makeIO({ stdin: encode.out })
    expect(await run(['--from-json', '--html', '--safe'], decode.io)).toBe(0)
    expect(decode.out).not.toContain('<script>')
  })

  it('documents both flags in --help', async () => {
    const t = makeIO()
    await run(['--help'], t.io)
    expect(t.out).toContain('--json, --ast')
    expect(t.out).toContain('--from-json')
  })
})

describe('carve CLI — --from-json is hostile-input tolerant', () => {
  it('reports a non-array children as a refusal, not a stack trace', async () => {
    // The VALUE of `children` is ruled now (§12(d), carve#881), so this is a
    // refusal rather than an empty document. What this test is FOR is unchanged
    // and is what it still asserts: malformed input reaches the user as a
    // documented failure and never as a stack trace.
    const t = makeIO({ stdin: '{"type":"document","srcByteLength":0,"children":{}}' })

    expect(await run(['--from-json', '--html'], t.io)).toBe(2)
    expect(t.err).toContain('is not a Carve AST')
    expect(t.err).not.toContain('    at ')
  })

  it('reports a root missing a §7 field instead of raising through the CLI', async () => {
    // PART 12 §12(a). The refusal has to reach the user as a documented failure;
    // before this, every typed ingest error - depth cap included - escaped
    // `fromAstJson` uncaught and surfaced as a stack trace.
    const t = makeIO({ stdin: '{"type":"document","children":[]}' })
    expect(await run(['--from-json', '--html'], t.io)).toBe(2)
    expect(t.err).toContain('srcByteLength')
    expect(t.err).not.toContain('at Object')
  })

  it('reports an unknown node type instead of rendering it', async () => {
    // §12(c) puts the refusal at DECODE. This engine used to accept the node and
    // fail in the renderer, which names a rendering problem for a payload one.
    const t = makeIO({
      stdin: JSON.stringify({
        type: 'document',
        srcByteLength: 0,
        children: [{ type: 'zzNotInTheSchema', children: [] }],
      }),
    })
    expect(await run(['--from-json', '--html'], t.io)).toBe(2)
    expect(t.err).toContain('zzNotInTheSchema')
  })

  it('refuses a footnote definition whose body is not a list of blocks', async () => {
    // Adopting it would put a string where every renderer iterates a body, so
    // the crash would surface inside the renderer for a document the decoder
    // had already accepted. It was DROPPED for that reason; §12(d) refuses it
    // at decode instead, which is the same crash avoided one step earlier and
    // with a typed error the caller can act on.
    const t = makeIO({
      stdin: JSON.stringify({
        type: 'document',
        srcByteLength: 0,
        children: [
          { type: 'paragraph', children: [{ type: 'footnote_ref', id: 'a' }] },
          { type: 'footnote', label: 'a', children: 'bad' },
        ],
      }),
    })

    expect(await run(['--from-json', '--html'], t.io)).toBe(2)
    expect(t.err).toContain('is not a Carve AST')
    expect(t.err).not.toContain('    at ')
  })

  it('applies the profile maxLength to the encoded payload', async () => {
    // The untrusted input on this path IS the JSON, so `--profile comment` has
    // to bound it; otherwise the flag stops meaning anything as soon as the
    // document arrives encoded.
    const big = JSON.stringify({
      type: 'document',
      srcByteLength: 0,
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x'.repeat(150_000) }] }],
    })
    const t = makeIO({ stdin: big })
    expect(await run(['--from-json', '--html', '--profile', 'comment'], t.io)).toBe(2)
    expect(t.err).toContain('maximum length')
  })

  it('lets a small encoded document through the same profile', async () => {
    // The mirror of the case above: a limit that rejected everything would pass
    // that test for the wrong reason.
    const encode = makeIO({ stdin: 'a short comment\n' })
    await run(['--json'], encode.io)
    const t = makeIO({ stdin: encode.out })
    expect(await run(['--from-json', '--html', '--profile', 'comment'], t.io)).toBe(0)
    expect(t.out).toContain('a short comment')
  })
})

describe('carve diff', () => {
  const files = {
    'a.crv': '# Title\n\nSee [docs](/a).\n',
    'b.crv': '# Title\n\nSee [docs](/b).\n',
    'a-rewrapped.crv': '# Title\n\nSee\n[docs](/a).\n',
  }

  it('exits 1 and names the change when the document differs', async () => {
    const t = makeIO({ files })
    expect(await run(['diff', 'a.crv', 'b.crv'], t.io)).toBe(1)
    expect(t.out).toContain('changed  link')
    expect(t.out).toContain('1 structural change')
  })

  it('exits 0 when only the bytes differ', async () => {
    // The gate this exists for: `fmt` and every editor with a wrap width move
    // bytes around without changing the document.
    const t = makeIO({ files })
    expect(await run(['diff', 'a.crv', 'a-rewrapped.crv'], t.io)).toBe(0)
    expect(t.out).toBe('no structural changes\n')
  })

  it('emits machine-readable changes under --json', async () => {
    const t = makeIO({ files })
    expect(await run(['diff', '--json', 'a.crv', 'b.crv'], t.io)).toBe(1)
    const changes = JSON.parse(t.out)
    expect(changes[0]).toMatchObject({ kind: 'changed', type: 'link', line: 3 })
  })

  it('refuses anything but two files', async () => {
    const t = makeIO({ files })
    expect(await run(['diff', 'a.crv'], t.io)).toBe(2)
    expect(t.err).toContain('exactly two files')
  })

  it('reports an unreadable file rather than throwing', async () => {
    const t = makeIO({ files })
    expect(await run(['diff', 'a.crv', 'missing.crv'], t.io)).toBe(2)
    expect(t.err).toContain('cannot read missing.crv')
  })

  it('appears in --help', async () => {
    const t = makeIO()
    await run(['--help'], t.io)
    expect(t.out).toContain('carve diff')
  })
})

describe('carve merge', () => {
  const files = {
    'base.crv': '# Old\n\nSee [docs](/a).\n',
    'ours.crv': '# New\n\nSee [docs](/a).\n',
    'theirs.crv': '# Old\n\nSee [docs](/b).\n',
    'other.crv': '# Other\n\nSee [docs](/a).\n',
  }

  it('combines independent edits as Carve source', async () => {
    const t = makeIO({ files })
    expect(await run(['merge', 'base.crv', 'ours.crv', 'theirs.crv'], t.io)).toBe(0)
    expect(t.out).toContain('New')
    expect(t.out).toContain('/b')
  })

  it('returns machine-readable conflicts without choosing a winner', async () => {
    const t = makeIO({ files })
    expect(await run(['merge', '--json', 'base.crv', 'ours.crv', 'other.crv'], t.io)).toBe(1)
    const result = JSON.parse(t.out)
    expect(result).toMatchObject({ ok: false, ast: null })
    expect(result.conflicts.length).toBeGreaterThan(0)
  })

  it('returns the same machine-readable envelope on success', async () => {
    const t = makeIO({ files })
    expect(await run(['merge', '--json', 'base.crv', 'ours.crv', 'theirs.crv'], t.io)).toBe(0)
    expect(JSON.parse(t.out)).toMatchObject({ ok: true, conflicts: [], ast: { type: 'document' } })
  })

  it('requires base, ours and theirs', async () => {
    const t = makeIO({ files })
    expect(await run(['merge', 'base.crv', 'ours.crv'], t.io)).toBe(2)
    expect(t.err).toContain('exactly three files')
  })
})

describe('carve portability', () => {
  it('reports a portable document and exits 0', async () => {
    const t = makeIO({ files: { 'a.crv': 'Plain prose.\n\nMore prose.\n' } })
    expect(await run(['portability', 'a.crv'], t.io)).toBe(0)
    expect(t.out).toContain('a.crv: portable')
  })

  it('reports a divergence with a line and both renderings, and exits 1', async () => {
    const t = makeIO({ files: { 'a.crv': 'Some intro prose.\n> A quote.\n' } })
    expect(await run(['portability', 'a.crv'], t.io)).toBe(1)
    expect(t.out).toContain('a.crv:1: diverges from Djot')
    expect(t.out).toContain('carve:')
    expect(t.out).toContain('djot:')
  })

  it('does not fire on the shapes the withdrawn lint rule got wrong', async () => {
    // carve-js#546: a bullet under a paragraph line is the same document in
    // both engines, and the old rule both flagged it and advised an edit that
    // changed the Carve document.
    const t = makeIO({ files: { 'a.crv': 'Some prose.\n- item\n' } })
    expect(await run(['portability', 'a.crv'], t.io)).toBe(0)
    expect(t.out).toContain('portable')
  })

  it('emits JSON with --json', async () => {
    const t = makeIO({ files: { 'a.crv': 'Some intro prose.\n> A quote.\n' } })
    expect(await run(['portability', '--json', 'a.crv'], t.io)).toBe(1)
    const parsed = JSON.parse(t.out) as Array<Record<string, unknown>>
    expect(parsed[0]!.file).toBe('a.crv')
    expect(parsed[0]!.portable).toBe(false)
    expect(parsed[0]!.line).toBe(1)
  })

  it('checks several files and exits 1 if any diverges', async () => {
    const t = makeIO({
      files: { 'a.crv': 'Plain prose.\n', 'b.crv': 'Some intro prose.\n> A quote.\n' },
    })
    expect(await run(['portability', 'a.crv', 'b.crv'], t.io)).toBe(1)
    expect(t.out).toContain('a.crv: portable')
    expect(t.out).toContain('b.crv:1: diverges')
  })

  it('reads stdin when given no files', async () => {
    const t = makeIO({ stdin: 'Plain prose.\n' })
    expect(await run(['portability'], t.io)).toBe(0)
    expect(t.out).toContain('<stdin>: portable')
  })

  it('reports an unreadable file as a usage error', async () => {
    const t = makeIO()
    expect(await run(['portability', 'nope.crv'], t.io)).toBe(2)
    expect(t.err).toContain('cannot read nope.crv')
  })

  it('appears in --help', async () => {
    const t = makeIO()
    await run(['--help'], t.io)
    expect(t.out).toContain('carve portability')
  })
})
