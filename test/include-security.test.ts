// Security and limits of include expansion (C2-N-011 to C2-N-014, C2-N-064 to C2-N-069): what an included file can
// reach, how much it can cost, and that it gets the treatment of the document that includes it.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { render, renderWithDiagnostics } from '../src/index.ts'
import { INCLUDE_BYTES } from '../src/include-tables.ts'
import { type IncludeRequest } from '../src/include-settings.ts'
import { fileResolver } from '../cli/include-fs.ts'
import { includes, virtualResolver } from './support/includes.ts'

const dirs: string[] = []

afterAll(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function tree(files: Readonly<Record<string, string>>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'carve-security-')))
  dirs.push(root)
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

function codes(src: string, options: Parameters<typeof renderWithDiagnostics>[1]): string[] {
  return renderWithDiagnostics(src, options).diagnostics.map((entry) => entry.code)
}

describe('containment', () => {
  it('C2-N-012, C2-N-013: traversal out of the root is refused before any test of existence', () => {
    const outside = tree({ 'secret.crv': 'TOP SECRET\n' })
    const root = join(outside, 'root')
    mkdirSync(root)
    const resolver = fileResolver(realpathSync(root))
    for (const path of ['../secret.crv', '../missing.crv', '../../../../../../etc/passwd', `${outside}/secret.crv`]) {
      const output = renderWithDiagnostics(`{{ ${path} }}`, { includes: resolver })
      expect(output.diagnostics.map((entry) => entry.code), path).toEqual(['include-outside-root', 'include-unresolved'])
      expect(output.html).not.toContain('SECRET')
    }
  })

  it('C2-N-012: a symbolic link inside the root that leads out of it is refused', () => {
    const outside = tree({ 'secret.crv': 'TOP SECRET\n' })
    const root = tree({})
    symlinkSync(join(outside, 'secret.crv'), join(root, 'inside.crv'))
    expect(codes('{{ inside.crv }}', { includes: fileResolver(root) })).toEqual(['include-outside-root', 'include-unresolved'])
  })

  it('C2-N-068: no message repeats a path or an error the resolver produced', () => {
    const root = tree({})
    const output = renderWithDiagnostics('{{ ../x.crv }}\n\n{{ nope.crv }}', { includes: fileResolver(root) })
    expect(JSON.stringify(output.diagnostics)).not.toContain(root)
  })
})

describe('limits', () => {
  it('C2-N-066: a cycle through three files is read once on its chain', () => {
    const calls: IncludeRequest[] = []
    const resolver = virtualResolver({ a: '{{ b }}\n', b: '{{ c }}\n', c: '{{ a }}\n' }, calls)
    expect(codes('{{ a }}', { includes: resolver })).toEqual(['include-cycle', 'include-unresolved'])
    expect(calls.map((call) => call.path)).toEqual(['a', 'b', 'c', 'a'])
  })

  it('C2-N-064: a chain 17 files deep stops at depth 16', () => {
    const files: Record<string, string> = {}
    for (let at = 1; at <= 17; at++) files[`d${at}`] = at === 17 ? 'bottom\n' : `{{ d${at + 1} }}\n`
    const calls: IncludeRequest[] = []
    const output = renderWithDiagnostics('{{ d1 }}', { includes: virtualResolver(files, calls) })
    expect(calls.length).toBe(16)
    expect(output.html).toBe('<p>{{ d17 }}</p>')
    expect(output.diagnostics.map((entry) => entry.code)).toEqual(['include-depth', 'include-unresolved'])
  })

  it('C2-N-065: the size cap of 8 MiB counts every text the resolver returns, the same file each time', () => {
    const half = 'x'.repeat(INCLUDE_BYTES / 2 - 1)
    const output = renderWithDiagnostics('{{ h }}\n\n{{ h }}\n\n{{ h }}', { includes: includes({ h: `${half}\n` }) })
    expect(output.diagnostics.map((entry) => entry.code)).toEqual(['include-budget', 'include-unresolved'])
    expect(output.html.endsWith('<p>{{ h }}</p>')).toBe(true)
  })

  it('C2-N-065: a single text past the cap is refused', () => {
    const output = renderWithDiagnostics('{{ big }}', { includes: includes({ big: 'x'.repeat(INCLUDE_BYTES + 1) }) })
    expect(output.diagnostics.map((entry) => entry.code)).toEqual(['include-budget', 'include-unresolved'])
  })

  it('C2-N-011: a file that is not text is refused, and no byte is replaced', () => {
    const root = tree({})
    writeFileSync(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]))
    writeFileSync(join(root, 'nul.crv'), Buffer.from('a\u0000b', 'utf8'))
    expect(codes('{{ image.png }}', { includes: fileResolver(root) })).toEqual(['include-non-text', 'include-unresolved'])
    expect(codes('{{ nul.crv }}', { includes: fileResolver(root) })).toEqual(['include-non-text', 'include-unresolved'])
    expect(render('{{ nul.crv }}', { includes: fileResolver(root) })).not.toContain('�')
  })
})

describe('included content is treated as the including document is', () => {
  const files = {
    'x.crv': '[click](javascript:alert(1)) <b>tag</b>\n\n```=html\n<script>alert(1)</script>\n```\n\n[ok](https://example.org)\n',
  }

  it('C2-N-069: the URL policy and the escaping of raw HTML apply to an included file', () => {
    expect(render('{{ x.crv }}', { includes: includes(files) }))
      .toBe(render('[click](javascript:alert(1)) <b>tag</b>\n\n```=html\n<script>alert(1)</script>\n```\n\n[ok](https://example.org)'))
    expect(render('{{ x.crv }}', { includes: includes(files) })).not.toContain('<script>')
  })

  it('C2-N-069: one urlPolicy and one rawHtml setting hold for the whole expanded tree', () => {
    const strict = render('{{ x.crv }}', { includes: includes(files), urlPolicy: { allow: ['mailto'] } })
    expect(strict).not.toContain('href="https://example.org"')
    const raw = render('{{ x.crv }}', { includes: includes(files), rawHtml: true })
    expect(raw).toContain('<script>alert(1)</script>')
  })

  it('C2-N-077: a profile tests an include like any block: under minimal it degrades', () => {
    const output = renderWithDiagnostics('{{ x.crv }}', { includes: includes(files), profile: 'minimal' })
    expect(output.html).toBe('<p>{{ x.crv }}</p>')
  })
})
