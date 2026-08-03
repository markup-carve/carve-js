#!/usr/bin/env node
/*
 * `carve` command-line tool.
 *
 * Currently one subcommand: `carve fix`, a thin wrapper over
 * applyMigrationFixes that rewrites Djot/Markdown delimiter collisions to
 * their Carve equivalents (see src/djot-migrate.ts).
 *
 * The work is done by `run(argv, io)`, which takes its I/O through an
 * injectable interface so it can be unit-tested without touching the real
 * filesystem, stdin, or process exit code. The bottom of the file wires the
 * real process I/O and invokes it only when executed as the binary.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import {
  applyMigrationFixes,
  djotMigrationWarnings,
  formatMigrationWarnings,
  lintCarve,
  formatLintWarnings,
  carveToHtml,
  carveToMarkdown,
  carveToCarve,
  carveToPlainText,
  carveToAnsi,
  carveToAstJson,
  diffAst,
  formatChanges,
  fromAstJson,
  toAstJson,
  applyProfile,
  renderHtml,
  renderMarkdown,
  renderCarve,
  renderPlainText,
  renderAnsi,
  Profile,
  ProfileViolationError,
  type AstJsonDocument,
  type MigrationWarning,
  type ProfileOptions,
} from './index.js'
import { stampCarve, readStamp, needsReview, type StampForm } from './stamp.js'
import { checkPortability, type DjotEngine, type PortabilityReport } from './portability.js'
import { LIB_VERSION, SPEC_VERSION } from './version.js'

/** Injectable I/O so `run` is testable without real fs / stdin / exit. */
export interface CliIO {
  /** Read all of stdin as UTF-8. */
  readStdin: () => Promise<string>
  /** Write to stdout. */
  write: (s: string) => void
  /** Write to stderr (diagnostics, skipped-warning reports). */
  writeErr: (s: string) => void
  /** Read a file as UTF-8; may throw (caught and reported per file). */
  readFile: (path: string) => string
  /** Write a file as UTF-8. */
  writeFile: (path: string, content: string) => void
}

const HELP = `carve - Carve markup tooling

Usage:
  carve [options] [file]           Render (default; the 'render' word is optional)
  carve render [options] [file]    Render Carve to HTML / Markdown / text / ANSI / Carve
  carve fmt [-w|--check] [--stamp] [files...] Format Carve source canonically
  carve fix [options] [files...]   Auto-fix delimiter collisions
  carve lint [files...]            Report problems without changing anything
  carve diff [--json] a.crv b.crv  Report what changed in the DOCUMENT
  carve portability [files...]     Report where a document reads differently
                                   in Djot (needs @djot/djot)

render - convert Carve source to an output format (reads a file or stdin).
The 'render' subcommand is optional: \`carve --ansi file\` works the same.

  render options (default --html; choose at most one):
    --html         HTML (default)
    --markdown     Markdown (--md)
    --plain        plain text (--plain-text)
    --ansi         ANSI-colored terminal text
    --json, --ast  the parsed AST as JSON (the PART 12 exchange format,
                   https://markup-carve.github.io/carve/ast-json)
    --stamp-info   report the document's provenance marker
    --stamp-check  exit 1 when the document predates this spec version
    --carve        canonical Carve source

  input options:
    --from-json    read an encoded AST instead of Carve source, and render it
                   to the chosen format

  safety options (for untrusted input; combine freely with a format above):
    --no-raw-html, --safe       escape =html raw blocks/spans instead of
                                emitting them. Affects --html, the only format
                                that can emit live HTML; the others already
                                escape it (--markdown), drop it (--plain), or
                                keep it as source text (--ansi, --carve).
    --profile NAME              restrict features (full|article|comment|minimal)
    --profile-base-host HOST    base host for the profile's link policy

fmt - format Carve source canonically.

  fmt options:
    -w, --write    Rewrite the given files in place
        --check    Exit 1 if any file is not formatted (no writes)
        --stdout   Print formatted output to stdout (single file or stdin)
        --stamp    Append a provenance marker (a comment recording the spec
                   version and engine) at the end of the document; replaces an
                   existing one. Deterministic (no timestamp); renders nothing.
        --stamp-block  Like --stamp but writes the multi-line %%% block form.

fix - rewrite Djot/Markdown delimiter collisions to their Carve equivalents,
constructs that otherwise silently mis-render under Carve (e.g. **bold**
-> *bold*, _em_ -> /em/, ~~strike~~ -> ~strike~, + bullets -> -).

  fix options:
    -w, --write    Rewrite the given files in place
        --check    Report files that would change; exit 1 if any (no writes)
        --stdout   Print the fixed output to stdout (single file or stdin)

  With no files, fix reads Carve source on stdin and writes the fixed result
  to stdout. Crossing collisions that cannot be auto-fixed are reported on
  stderr for manual review.

diff - compare two documents STRUCTURALLY: what changed in the tree, not in
the bytes. Reflowing a paragraph, re-indenting a list or running fmt reports
nothing; an edited link destination, a moved section or a changed heading level
reports one line each. Exits 1 when the documents differ, 0 when they do not,
so it works as a gate over stored content.

  diff options:
        --json     Emit the changes as JSON (kind, type, path, line, detail)

portability - does this document MEAN the same thing in Djot? Renders it with
both engines and reports the first place they disagree. This is a measurement,
not a heuristic: it reports a divergence exactly when the two renderings differ,
so it cannot be wrong about one. Note that Carve's deliberate departures from
Djot (\`/italic/\` vs \`_underline_\`, \`=mark=\`, quoted link titles) ARE
divergences and are reported as such - a document using them does not mean the
same thing in Djot, which is the question being asked. Exits 1 when any document
diverges, 0 when all are portable.

  Needs djot.js, which this package does not depend on:
      npm install @djot/djot

  portability options:
        --json     Emit the report as JSON (file, portable, line, carve, djot)

lint - report silent-failure problems as \`file:line:col rule - message\`:
broken </#id> cross-references, unresolved reference links, duplicate heading
ids, missing/duplicate/unused footnotes, trailing {…} attribute blocks on
headings (literal, not attributes), legacy \`\`\`raw FORMAT fences (use
\`\`\`=FORMAT), and lines that open like a block (\`:::\`, \`{#\`) but parsed as
plain text. Also flags Djot/Markdown constructs that mis-render in Carve
(\`**bold**\`, \`~~strike~~\`, \`^sup^\`, \`+\` bullets). Reads files or stdin;
exits 1 if anything is reported, 0 if clean.

  lint options:
        --from-djot  Also flag valid Carve whose meaning differs from Djot
                     (\`_x_\` underline vs emphasis, \`~x~\` strike vs subscript,
                     \`{=x=}\` highlight) — noise for hand-written Carve, useful
                     when checking a document migrated from Djot.
        --portable   Deprecated compatibility option; blockquote marker spacing
                     is now core Carve syntax and is always checked. For an
                     actual portability check see the \`portability\`
                     subcommand, which measures the difference instead of
                     guessing at it.
  -h, --help     Show this help
`

/** Report the un-auto-fixable (overlapping) warnings for one input. */
function reportSkipped(skipped: MigrationWarning[], file: string, io: CliIO): void {
  if (skipped.length === 0) return
  const n = skipped.length
  io.writeErr(
    `${file}: ${n} overlapping collision${n === 1 ? '' : 's'} need manual review:\n`,
  )
  io.writeErr(formatMigrationWarnings(skipped, file) + '\n')
}

function plural(n: number): string {
  return n === 1 ? '' : 's'
}

async function runFix(args: string[], io: CliIO): Promise<number> {
  let values: { write?: boolean; check?: boolean; stdout?: boolean; help?: boolean }
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args,
      options: {
        write: { type: 'boolean', short: 'w' },
        check: { type: 'boolean' },
        stdout: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    })
    values = parsed.values
    positionals = parsed.positionals
  } catch (e) {
    io.writeErr(`carve fix: ${(e as Error).message}\n`)
    return 2
  }

  if (values.help) {
    io.write(HELP)
    return 0
  }

  const modes = [values.write, values.check, values.stdout].filter(Boolean).length
  if (modes > 1) {
    io.writeErr('carve fix: choose at most one of --write, --check, --stdout\n')
    return 2
  }

  const files = positionals

  // No files: stream stdin -> stdout (or --check the stream).
  if (files.length === 0) {
    if (values.write) {
      io.writeErr('carve fix: --write requires file arguments\n')
      return 2
    }
    const src = await io.readStdin()
    const res = applyMigrationFixes(src)
    reportSkipped(res.skipped, '<stdin>', io)
    if (values.check) return res.applied.length > 0 ? 1 : 0
    io.write(res.output)
    return 0
  }

  if (values.stdout && files.length > 1) {
    io.writeErr('carve fix: --stdout takes a single file\n')
    return 2
  }

  const mode: 'write' | 'stdout' | 'check' = values.write
    ? 'write'
    : values.stdout
      ? 'stdout'
      : 'check'

  let changed = 0
  let skippedTotal = 0
  let hadError = false

  for (const file of files) {
    let src: string
    try {
      src = io.readFile(file)
    } catch {
      io.writeErr(`carve fix: cannot read ${file}\n`)
      hadError = true
      continue
    }
    const res = applyMigrationFixes(src)
    skippedTotal += res.skipped.length
    reportSkipped(res.skipped, file, io)
    const applied = res.applied.length

    if (mode === 'stdout') {
      io.write(res.output)
      continue
    }
    if (applied === 0) continue
    changed++
    if (mode === 'write') {
      io.writeFile(file, res.output)
      io.writeErr(`fixed ${file} (${applied} change${plural(applied)})\n`)
    } else {
      io.writeErr(`would fix ${file} (${applied} change${plural(applied)})\n`)
    }
  }

  if (hadError) return 2
  // --check is a gate: non-zero if anything would change or needs manual work.
  if (mode === 'check') return changed > 0 || skippedTotal > 0 ? 1 : 0
  return 0
}

async function runFmt(args: string[], io: CliIO): Promise<number> {
  let values: {
    write?: boolean
    check?: boolean
    stdout?: boolean
    stamp?: boolean
    'stamp-block'?: boolean
    help?: boolean
  }
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args,
      options: {
        write: { type: 'boolean', short: 'w' },
        check: { type: 'boolean' },
        stdout: { type: 'boolean' },
        stamp: { type: 'boolean' },
        'stamp-block': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    })
    values = parsed.values
    positionals = parsed.positionals
  } catch (e) {
    io.writeErr(`carve fmt: ${(e as Error).message}\n`)
    return 2
  }

  if (values.help) {
    io.write(HELP)
    return 0
  }

  const modes = [values.write, values.check, values.stdout].filter(Boolean).length
  if (modes > 1) {
    io.writeErr('carve fmt: choose at most one of --write, --check, --stdout\n')
    return 2
  }

  // `--stamp` writes a one-liner provenance marker; `--stamp-block` the block
  // form. Format, then stamp, so the marker lands on canonical output.
  const stampForm: StampForm | null = values['stamp-block'] ? 'block' : values.stamp ? 'line' : null
  const format = (src: string): string => {
    const out = carveToCarve(src)
    return stampForm ? stampCarve(out, `carve-js ${LIB_VERSION}`, stampForm) : out
  }

  const files = positionals

  if (files.length === 0) {
    if (values.write) {
      io.writeErr('carve fmt: --write requires file arguments\n')
      return 2
    }
    const src = await io.readStdin()
    const out = format(src)
    if (values.check) return out === src ? 0 : 1
    io.write(out)
    return 0
  }

  if (values.stdout && files.length > 1) {
    io.writeErr('carve fmt: --stdout takes a single file\n')
    return 2
  }

  const mode: 'write' | 'stdout' | 'check' = values.write
    ? 'write'
    : values.check
      ? 'check'
      : 'stdout'

  let changed = 0
  let hadError = false

  for (const file of files) {
    let src: string
    try {
      src = io.readFile(file)
    } catch {
      io.writeErr(`carve fmt: cannot read ${file}\n`)
      hadError = true
      continue
    }
    const out = format(src)
    if (mode === 'stdout') {
      io.write(out)
      continue
    }
    if (out === src) continue
    changed++
    if (mode === 'write') {
      io.writeFile(file, out)
    } else {
      io.writeErr(`${file}\n`)
    }
  }

  if (hadError) return 2
  return mode === 'check' && changed > 0 ? 1 : 0
}

/**
 * Render a document handed in as PART 12 JSON rather than as Carve source.
 *
 * The AST is the interchange format, so a tool that produced one - an editor, a
 * converter, another engine - can render it here without round-tripping through
 * Carve source it would have to re-parse. It is also the only way to exercise
 * PART 12 §6 from the command line: `--json` then `--from-json --json` must
 * come back to the same tree.
 *
 * Malformed input is a user error (exit 2), not a crash: this reads whatever
 * the caller passes, including a file that is not JSON at all.
 */
function renderFromJson(
  src: string,
  target: 'html' | 'markdown' | 'plain' | 'ansi' | 'carve' | 'json',
  opts: ProfileOptions & { allowRawHtml?: false },
  io: CliIO,
): number {
  // A profile's maxLength bounds UNTRUSTED INPUT, and on this path the untrusted
  // input is the JSON payload - it is what gets parsed, held in memory and
  // walked. Skipping the check because nothing parses Carve here would let
  // `--profile comment` accept an arbitrarily large document as long as it
  // arrived encoded, which is the one thing that flag is for.
  //
  // Measured against the payload rather than the source it encodes, because the
  // source no longer exists at this point. An encoded document is several times
  // its own source, so a host storing trees should size the limit for the form
  // it stores - the error says which form was measured.
  const maxLength = opts.profile?.getMaxLength() ?? 0
  if (maxLength > 0) {
    const size = Buffer.byteLength(src, 'utf8')
    if (size > maxLength) {
      io.writeErr(
        `carve render: encoded AST exceeds the profile's maximum length of ${maxLength} bytes ` +
          `(got ${size} bytes of JSON).\n`,
      )
      return 2
    }
  }

  let json: AstJsonDocument
  try {
    json = JSON.parse(src) as AstJsonDocument
  } catch (e) {
    io.writeErr(`carve render: --from-json input is not valid JSON (${(e as Error).message})\n`)
    return 2
  }
  if (json === null || typeof json !== 'object' || json.type !== 'document') {
    io.writeErr("carve render: --from-json input is not a Carve AST (expected a root of type 'document')\n")
    return 2
  }

  let doc = fromAstJson(json)
  if (opts.profile) {
    doc = applyProfile(doc, opts.profile, opts.profileBaseHost ?? null).doc
  }

  let out: string
  try {
    switch (target) {
      case 'json':
        out = JSON.stringify(toAstJson(doc), null, 2)
        break
      case 'html':
        // The only render option the CLI exposes; the rest of `opts` is parse
        // and profile configuration, which was already applied above.
        out = renderHtml(doc, opts.allowRawHtml === false ? { allowRawHtml: false } : {})
        break
      case 'markdown':
        out = renderMarkdown(doc)
        break
      case 'plain':
        out = renderPlainText(doc)
        break
      case 'ansi':
        out = renderAnsi(doc)
        break
      case 'carve':
        out = renderCarve(doc)
        break
    }
  } catch (e) {
    if (e instanceof ProfileViolationError) {
      io.writeErr(`carve render: ${e.message}\n`)
      return 2
    }
    throw e
  }
  if (!out.endsWith('\n')) out += '\n'
  io.write(out)
  return 0
}

async function runRender(args: string[], io: CliIO): Promise<number> {
  let values: {
    html?: boolean
    markdown?: boolean
    carve?: boolean
    plain?: boolean
    ansi?: boolean
    md?: boolean
    json?: boolean
    ast?: boolean
    'from-json'?: boolean
    'plain-text'?: boolean
    'stamp-info'?: boolean
    'stamp-check'?: boolean
    'no-raw-html'?: boolean
    safe?: boolean
    profile?: string
    'profile-base-host'?: string
    help?: boolean
  }
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args,
      options: {
        html: { type: 'boolean' },
        markdown: { type: 'boolean' },
        carve: { type: 'boolean' },
        plain: { type: 'boolean' },
        ansi: { type: 'boolean' },
        md: { type: 'boolean' },
        json: { type: 'boolean' },
        ast: { type: 'boolean' },
        'from-json': { type: 'boolean' },
        'plain-text': { type: 'boolean' },
        'stamp-info': { type: 'boolean' },
        'stamp-check': { type: 'boolean' },
        'no-raw-html': { type: 'boolean' },
        safe: { type: 'boolean' },
        profile: { type: 'string' },
        'profile-base-host': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    })
    values = parsed.values
    positionals = parsed.positionals
  } catch (e) {
    io.writeErr(`carve render: ${(e as Error).message}\n`)
    return 2
  }

  if (values.help) {
    io.write(HELP)
    return 0
  }

  // Fold the carve-rs-compatible aliases into their canonical flags before the
  // "at most one" check, so `--md --markdown` is one format, not two.
  if (values.md) values.markdown = true
  if (values['plain-text']) values.plain = true
  // `--ast` is carve-php's spelling of the same flag; folding it here keeps one
  // format in `chosen` rather than two.
  if (values.ast) values.json = true

  const chosen = (['html', 'markdown', 'plain', 'ansi', 'carve', 'json'] as const).filter(
    (f) => values[f],
  )
  if (chosen.length > 1) {
    io.writeErr(
      'carve render: choose at most one of --html, --markdown, --plain, --ansi, --carve, --json\n',
    )
    return 2
  }
  if (positionals.length > 1) {
    io.writeErr('carve render: takes a single file (or stdin)\n')
    return 2
  }
  const target = chosen[0] ?? 'html'
  if ((values.profile !== undefined || values['profile-base-host'] !== undefined) && target === 'carve') {
    io.writeErr(
      'carve render: profiles cannot be used with --carve because the Carve formatter formats what the author wrote rather than the filtered output\n',
    )
    return 2
  }
  if (values['profile-base-host'] !== undefined && values.profile === undefined) {
    io.writeErr('carve render: --profile-base-host requires --profile\n')
    return 2
  }

  const opts: ProfileOptions & { allowRawHtml?: false } = {}
  if (values['no-raw-html'] || values.safe) opts.allowRawHtml = false
  if (values.profile !== undefined) {
    switch (values.profile) {
      case 'full':
        opts.profile = Profile.full()
        break
      case 'article':
        opts.profile = Profile.article()
        break
      case 'comment':
        opts.profile = Profile.comment()
        break
      case 'minimal':
        opts.profile = Profile.minimal()
        break
      default:
        io.writeErr(
          `carve render: unknown profile '${values.profile}' (expected full, article, comment or minimal)\n`,
        )
        return 2
    }
  }
  if (values['profile-base-host'] !== undefined) {
    opts.profileBaseHost = values['profile-base-host']
  }

  let src: string
  if (positionals.length === 0) {
    src = await io.readStdin()
  } else {
    try {
      src = io.readFile(positionals[0]!)
    } catch {
      io.writeErr(`carve render: cannot read ${positionals[0]}\n`)
      return 2
    }
  }

  // The stamp modes answer a question about the document rather than rendering
  // it, so they report and return before any renderer runs.
  if (values['stamp-info'] || values['stamp-check']) {
    const stamp = readStamp(src)
    if (stamp === null) {
      io.write(`unstamped (spec version unknown; this engine targets ${SPEC_VERSION})\n`)
    } else {
      io.write(
        `carve-version: ${stamp.version}\n` +
          `generated-by: ${stamp.generatedBy ?? '(unrecorded)'}\n` +
          `this engine targets: ${SPEC_VERSION}\n`,
      )
    }

    if (values['stamp-check'] && needsReview(src)) {
      io.writeErr(`Review the [behavior] changelog entries between that version and ${SPEC_VERSION}.\n`)
      return 1
    }

    return 0
  }

  // --from-json reads an encoded AST instead of Carve source. The render path
  // below takes source, so this branch runs the renderers directly over the
  // decoded tree - and applies the profile itself, since nothing parsed here.
  if (values['from-json']) return renderFromJson(src, target, opts, io)

  let out: string
  try {
    switch (target) {
      case 'json':
        out = JSON.stringify(carveToAstJson(src, opts), null, 2)
        break
      case 'html':
        out = carveToHtml(src, opts)
        break
      case 'markdown':
        out = carveToMarkdown(src, opts)
        break
      case 'plain':
        out = carveToPlainText(src, opts)
        break
      case 'ansi':
        out = carveToAnsi(src, opts)
        break
      case 'carve':
        out = carveToCarve(src, opts)
        break
    }
  } catch (e) {
    if (e instanceof ProfileViolationError) {
      io.writeErr(`carve render: ${e.message}\n`)
      return 2
    }
    // A profile's maxLength rejection arrives as a RangeError from
    // enforceProfileMaxLength. It is a rejected input like any other profile
    // rejection, so it exits 2 here rather than reaching the generic handler
    // and reporting exit 1. Only treated this way when a profile is set,
    // which is the only way that throw can happen.
    if (opts.profile && e instanceof RangeError) {
      io.writeErr(`carve render: ${e.message}\n`)
      return 2
    }
    throw e
  }
  if (!out.endsWith('\n')) out += '\n'
  io.write(out)
  return 0
}

/**
 * Dispatch a `carve` invocation. `argv` is the argument list *after* `node`
 * and the script path (i.e. `process.argv.slice(2)`). Returns the intended
 * process exit code.
 */
export async function run(argv: string[], io: CliIO): Promise<number> {
  const [sub, ...rest] = argv
  if (sub === '--help' || sub === '-h') {
    io.write(HELP)
    return 0
  }
  // No arguments: render from stdin (HTML), matching the carve-rs / carve-php
  // CLIs so `echo '# Hi' | carve` works. The real binary still shows help when
  // stdin is an interactive TTY (see the wrapper at the bottom of this file).
  if (sub === undefined) return runRender([], io)
  if (sub === 'render') return runRender(rest, io)
  if (sub === 'fmt') return runFmt(rest, io)
  if (sub === 'fix') return runFix(rest, io)
  if (sub === 'lint') return runLint(rest, io)
  if (sub === 'diff') return runDiff(rest, io)
  if (sub === 'portability') return runPortability(rest, io)
  // Default action is render, so the `render` subcommand is optional:
  // `carve --ansi file.crv` / `carve file.crv` render directly (matching the
  // carve-rs / carve-php CLIs). A first arg that is not fix/lint/render is a
  // format flag or an input file, handled by runRender over the full argv.
  return runRender(argv, io)
}

/** Report all warnings for one source; returns how many were found. */
function reportLint(
  source: string,
  file: string,
  io: CliIO,
  fromDjot: boolean,
  portable: boolean,
): number {
  // Default lint targets hand-written Carve, so it reports only constructs
  // that mis-render in Carve (`carve-breakage`). Djot-semantic shifts such as
  // `_x_` (underline, not emphasis) are valid Carve and only matter when the
  // source is being migrated FROM Djot, so they surface only with --from-djot.
  const migration = djotMigrationWarnings(source).filter(
    (w) => fromDjot || w.category === 'carve-breakage',
  )
  const semantic = lintCarve(source, { portable })
  if (migration.length) io.write(formatMigrationWarnings(migration, file) + '\n')
  if (semantic.length) io.write(formatLintWarnings(semantic, file) + '\n')
  return migration.length + semantic.length
}

/**
 * `carve diff a.crv b.crv` - what changed in the DOCUMENT, not in the bytes.
 *
 * Exits 1 when the documents differ, 0 when they do not, so it works as a gate:
 * a formatter run, a re-wrap or a re-indent that leaves the tree alone exits 0,
 * while an edit that changes content exits 1.
 */
async function runDiff(args: string[], io: CliIO): Promise<number> {
  let values: { json?: boolean; help?: boolean }
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args,
      options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
    })
    values = parsed.values
    positionals = parsed.positionals
  } catch (e) {
    io.writeErr(`carve diff: ${(e as Error).message}\n`)
    return 2
  }
  if (values.help) {
    io.write(HELP)
    return 0
  }
  if (positionals.length !== 2) {
    io.writeErr('carve diff: takes exactly two files (before, after)\n')
    return 2
  }

  const sources: string[] = []
  for (const file of positionals) {
    try {
      sources.push(io.readFile(file))
    } catch {
      io.writeErr(`carve diff: cannot read ${file}\n`)
      return 2
    }
  }

  const changes = diffAst(carveToAstJson(sources[0]!), carveToAstJson(sources[1]!))
  io.write(values.json ? `${JSON.stringify(changes, null, 2)}\n` : formatChanges(changes))

  return changes.length > 0 ? 1 : 0
}

/**
 * Load djot.js, or explain how to get it.
 *
 * Deliberately not a dependency of this package: `carve` has none, and every
 * user who never runs this subcommand should keep it that way. It is declared
 * as an OPTIONAL peer instead, so a project that wants the check installs it
 * explicitly and npm does not pull a second parser into everyone else's tree.
 */
/**
 * Pick the engine out of a loaded module, whichever shape it arrived in.
 *
 * djot.js is CommonJS. Imported by its package specifier it comes through the
 * package's own export map with the functions at the top level; imported by
 * RESOLVED PATH - which the cwd fallback below has to do - Node's interop puts
 * the same functions on `default` instead. Checking for the methods rather than
 * assuming either shape also means a module that is not djot at all is
 * rejected here instead of failing later as "parse is not a function".
 */
function asDjotEngine(mod: unknown): DjotEngine | undefined {
  for (const candidate of [mod, (mod as { default?: unknown } | undefined)?.default]) {
    const engine = candidate as Partial<DjotEngine> | undefined
    if (typeof engine?.parse === 'function' && typeof engine?.renderHTML === 'function') {
      return engine as DjotEngine
    }
  }
  return undefined
}

async function loadDjot(io: CliIO): Promise<DjotEngine | undefined> {
  const beside = await import('@djot/djot').then(asDjotEngine, () => undefined)
  if (beside) return beside
  // Not beside `carve` itself. The common case for a CLI is a GLOBAL install
  // (`npm i -g @markup-carve/carve`) checking a document in some project, and
  // `npm install @djot/djot` there puts the peer in THAT project's
  // node_modules - which a bare import from this module cannot see. So try
  // again from the working directory before giving up.
  try {
    const fromCwd = createRequire(join(process.cwd(), 'noop.js'))
    const resolved = fromCwd.resolve('@djot/djot')
    const engine = asDjotEngine(await import(pathToFileURL(resolved).href))
    if (engine) return engine
  } catch {
    // Fall through to the hint: not resolvable from here either.
  }
  io.writeErr(
    'carve portability: needs djot.js, which carve does not depend on.\n' +
      '  npm install @djot/djot\n',
  )
  return undefined
}

/** `carve portability file.crv` - render with both engines and compare. */
async function runPortability(args: string[], io: CliIO): Promise<number> {
  let values: { json?: boolean; help?: boolean }
  let positionals: string[]
  try {
    const parsed = parseArgs({
      args,
      options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
    })
    values = parsed.values
    positionals = parsed.positionals
  } catch (e) {
    io.writeErr(`carve portability: ${(e as Error).message}\n`)
    return 2
  }
  if (values.help) {
    io.write(HELP)
    return 0
  }

  const djot = await loadDjot(io)
  if (!djot) return 2

  const inputs: Array<{ file: string; source: string }> = []
  if (positionals.length === 0) {
    inputs.push({ file: '<stdin>', source: await io.readStdin() })
  } else {
    for (const file of positionals) {
      try {
        inputs.push({ file, source: io.readFile(file) })
      } catch {
        io.writeErr(`carve portability: cannot read ${file}\n`)
        return 2
      }
    }
  }

  // `sourceLine` is what lets the report name a line: the attribute rides on
  // the rendered blocks, and the comparison drops it on both sides.
  const render = (src: string) => carveToHtml(src, { sourceLine: true })
  const reports = inputs.map((i) => ({
    file: i.file,
    report: checkPortability(i.source, djot, render),
  }))

  if (values.json) {
    io.write(
      JSON.stringify(
        reports.map(({ file, report }) => ({ file, ...flattenReport(report) })),
        null,
        2,
      ) + '\n',
    )
  } else {
    for (const { file, report } of reports) io.write(formatPortability(file, report))
  }
  return reports.some((r) => !r.report.portable) ? 1 : 0
}

function flattenReport(report: PortabilityReport): Record<string, unknown> {
  if (report.portable) return { portable: true }
  const d = report.divergence!
  return { portable: false, ...(d.line !== undefined ? { line: d.line } : {}), carve: d.carve, djot: d.djot }
}

function formatPortability(file: string, report: PortabilityReport): string {
  if (report.portable) return `${file}: portable\n`
  const d = report.divergence!
  const where = d.line !== undefined ? `${file}:${d.line}` : file
  return `${where}: diverges from Djot\n  carve: ${d.carve}\n  djot:  ${d.djot}\n`
}

async function runLint(args: string[], io: CliIO): Promise<number> {
  let positionals: string[]
  let fromDjot: boolean
  let portable: boolean
  try {
    const parsed = parseArgs({
      args,
      options: {
        help: { type: 'boolean', short: 'h' },
        'from-djot': { type: 'boolean' },
        portable: { type: 'boolean' },
      },
      allowPositionals: true,
    })
    if (parsed.values.help) {
      io.write(HELP)
      return 0
    }
    positionals = parsed.positionals
    fromDjot = parsed.values['from-djot'] ?? false
    portable = parsed.values.portable ?? false
  } catch (e) {
    io.writeErr(`carve lint: ${(e as Error).message}\n`)
    return 2
  }

  if (positionals.length === 0) {
    const src = await io.readStdin()
    return reportLint(src, '<stdin>', io, fromDjot, portable) > 0 ? 1 : 0
  }

  let total = 0
  let hadError = false
  for (const file of positionals) {
    let src: string
    try {
      src = io.readFile(file)
    } catch {
      io.writeErr(`carve lint: cannot read ${file}\n`)
      hadError = true
      continue
    }
    total += reportLint(src, file, io, fromDjot, portable)
  }
  if (hadError) return 2
  return total > 0 ? 1 : 0
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const realIO: CliIO = {
  readStdin,
  write: (s) => void process.stdout.write(s),
  writeErr: (s) => void process.stderr.write(s),
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, c) => writeFileSync(p, c, 'utf8'),
}

// Run only when executed as the binary, not when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  // With no args and an interactive terminal there is nothing to render, so
  // show help instead of silently blocking on stdin. Piped/redirected input
  // (`echo … | carve`) falls through to render from stdin.
  if (args.length === 0 && process.stdin.isTTY) {
    process.stderr.write(HELP)
    process.exitCode = 2
  } else {
    run(args, realIO).then(
      (code) => {
        process.exitCode = code
      },
      (err) => {
        process.stderr.write(`carve: ${(err as Error).message}\n`)
        process.exitCode = 1
      },
    )
  }
}
