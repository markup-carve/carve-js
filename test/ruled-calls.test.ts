// The 0.1 calls brought back in the 0.2 shape (ruling of 19 November 2026): the Prettier plugin, tree diff and patch
// with fingerprints, upgrade edits, the package constants, headingId, includeRegion and the file resolver limits.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as prettier from 'prettier'
import { describe, expect, it } from 'vitest'
import {
  applyPatch, CarveOptionError, CarvePatchError, diffTree, encodeTree, format, headingId, includeDependencies, includeRegion,
  NODE_TYPES, parse, render, sourceFingerprint, SPEC_VERSION, treeFingerprint, VERSION,
} from '../public/index.ts'
import { fileSystemResolver } from '../public/node.ts'
import { type IncludeRequest } from '../src/include-settings.ts'
import * as plugin from '../public/prettier.ts'
import { upgrade } from '../public/upgrade.ts'
import { generatePackageInfo } from '../scripts/generate-package-info.ts'
import { CARVE_SOURCES, EXAMPLES } from '../scripts/corpus.ts'

const root = join(import.meta.dirname, '..')
const request = (path: string): IncludeRequest => ({ path, options: {} })
const read = (path: string): string => readFileSync(join(root, path), 'utf8')

describe('the Prettier plugin', () => {
  // Prettier turns every line ending into a line feed before a plugin sees the text, and writes a blank file as empty.
  const formatted = CARVE_SOURCES.filter(({ input }) => !input.includes('\r') && input.trim() !== '').flatMap(({ id, input }) => {
    try {
      return [{ id, input, expected: format(input) }]
    } catch {
      return []
    }
  })

  it('formats every source of the 0.2 corpus as format does', async () => {
    expect(formatted.length).toBeGreaterThan(1000)
    for (const { id, input, expected } of formatted) {
      expect(await prettier.format(input, { parser: 'carve', plugins: [plugin] }), id).toBe(expected)
    }
  })

  it('passes carveAlignTables and carveNormalize to format', async () => {
    const table = '| a | bbb |\n| cc | d |\n'
    expect(await prettier.format(table, { parser: 'carve', plugins: [plugin], carveAlignTables: true } as prettier.Options))
      .toBe(format(table, { alignTables: true }))
    const source = '- a\n\n- b\n'
    expect(await prettier.format(source, { parser: 'carve', plugins: [plugin], carveNormalize: true } as prettier.Options))
      .toBe(format(source, { normalize: true }))
  })

  it('claims .crv files', async () => {
    expect(await prettier.format('= Title\n', { filepath: 'a.crv', plugins: [plugin] })).toBe(format('= Title\n'))
  })
})

describe('diffTree and applyPatch', () => {
  it('a patch between two example trees turns the first into the second', () => {
    const trees = EXAMPLES.slice(0, 80).map((example) => parse(example.input))
    for (let at = 1; at < trees.length; at++) {
      const [a, b] = [trees[at - 1]!, trees[at]!]
      const patch = diffTree(a, b)
      expect(diffTree(applyPatch(a, patch, { fingerprint: treeFingerprint(a) }), b)).toEqual([])
    }
  })

  it('equal trees give the empty patch, addressed with RFC 6901 pointers otherwise', () => {
    expect(diffTree(parse('a'), parse('a'))).toEqual([])
    const patch = diffTree(parse('a b', { positions: false }), parse('a c', { positions: false }))
    expect(patch).toEqual([{ op: 'replace', path: '/children/0/children/0/value', value: 'a c' }])
  })

  it('refuses a tree whose fingerprint differs, with one error', () => {
    const tree = parse('a')
    expect(() => applyPatch(tree, [], { fingerprint: treeFingerprint(parse('b')) })).toThrow(CarvePatchError)
  })

  it('refuses a result that does not decode, naming its path', () => {
    const tree = parse('a', { positions: false })
    try {
      applyPatch(tree, [{ op: 'replace', path: '/children/0/type', value: 'nope' }])
      throw new Error('accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(CarvePatchError)
      expect((error as CarvePatchError).path).toBe('/children/0')
    }
  })

  it('refuses a failing operation at its index in the patch, and leaves the tree as it was', () => {
    const tree = parse('a', { positions: false })
    const before = encodeTree(tree)
    for (const [patch, path] of [
      [[{ op: 'remove', path: '/children/3' }], '/0/path'],
      [[{ op: 'test', path: '/type', value: 'x' }], '/0/value'],
      [[{ op: 'add', path: '/children/-', value: { type: 'thematic_break' } }, { op: 'jump', path: '' }], '/1/op'],
    ] as const) {
      try {
        applyPatch(tree, patch as never)
        throw new Error('accepted')
      } catch (error) {
        expect((error as CarvePatchError).path).toBe(path)
      }
    }
    expect(encodeTree(tree)).toBe(before)
  })

  it('tests values without regard to member order, and refuses a value that is no JSON', () => {
    const tree = parse('a', { positions: false })
    const reversed = Object.fromEntries(Object.entries(JSON.parse(encodeTree(tree)) as object).reverse())
    expect(() => applyPatch(tree, [{ op: 'test', path: '', value: reversed }])).not.toThrow()
    for (const value of [undefined, 1n, Number.NaN, new Date(0)]) {
      try {
        applyPatch(tree, [{ op: 'add', path: '/children/-', value }])
        throw new Error('accepted')
      } catch (error) {
        expect((error as CarvePatchError).path).toBe('/0/value')
      }
    }
  })

  it('applies move and copy', () => {
    const tree = parse('a\n\nb\n', { positions: false })
    const moved = applyPatch(tree, [{ op: 'move', from: '/children/0', path: '/children/1' }])
    expect(encodeTree(moved)).toBe(encodeTree(parse('b\n\na\n', { positions: false })))
    const copied = applyPatch(tree, [{ op: 'copy', from: '/children/0', path: '/children/-' }])
    expect(copied.children).toHaveLength(3)
  })

  it('fingerprints are sha256 of the UTF-8 bytes, alike for text and bytes', () => {
    expect(sourceFingerprint('abc')).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sourceFingerprint(new TextEncoder().encode('ä'))).toBe(sourceFingerprint('ä'))
    const tree = parse('a')
    expect(treeFingerprint(tree)).toBe(sourceFingerprint(encodeTree(tree)))
  })
})

describe('carve diff', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carve-diff-'))
  writeFileSync(join(dir, 'a.crv'), 'a /b/\n')
  writeFileSync(join(dir, 'b.crv'), 'a *b*\n')
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'cli/main.ts'), 'diff', ...args],
    { cwd: dir, encoding: 'utf8' })

  it('writes the patch and exits 1 when the trees differ', () => {
    const result = cli('--json', 'a.crv', 'b.crv')
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toEqual(diffTree(parse('a /b/\n', { positions: false }), parse('a *b*\n', { positions: false })))
    expect(cli('a.crv', 'b.crv').stdout).toBe('replace /children/0/children/1 {"type":"strong","children":[{"type":"text","value":"b"}]}\n')
  })

  it('reads source bytes that are not well-formed UTF-8, as render does', () => {
    writeFileSync(join(dir, 'c.crv'), Uint8Array.from([0x61, 0xff, 0x0a]))
    expect(cli('c.crv', 'c.crv').status).toBe(0)
  })

  it('exits 0 for equal trees and 2 without two files', () => {
    expect(cli('a.crv', 'a.crv').status).toBe(0)
    expect(cli('a.crv').status).toBe(2)
  })
})

describe('upgrade edits', () => {
  const sources = ['Some _it_ text.\n', '# Title\n\nSome *bold* and _it_ text.\n\n- a\n- b\n', 'a\n\nb ^x^ c\n']

  it('the edits applied to the 0.1 source give the 0.2 source, each with its upgrade row', () => {
    for (const source of sources) {
      const result = upgrade(source, { edits: true })
      let bytes = new TextEncoder().encode(source)
      for (const edit of [...result.edits!].reverse()) {
        const text = new TextEncoder().encode(edit.text)
        bytes = new Uint8Array([...bytes.subarray(0, edit.range.startOffset), ...text, ...bytes.subarray(edit.range.endOffset)])
        expect(edit.entry).toMatch(/^U-\d+$|^upgrade$/)
      }
      expect(new TextDecoder().decode(bytes), source).toBe(result.output)
      expect(result.edits!.length > 0).toBe(result.changed)
    }
  })

  it('gives no edits unless asked', () => {
    expect(upgrade('Some _it_ text.\n').edits).toBeUndefined()
  })
})

describe('the package constants', () => {
  it('src/package-info.ts is what scripts/generate-package-info.ts writes', () => {
    expect(read('src/package-info.ts'))
      .toBe(generatePackageInfo(read('package.json'), read('data/spec-pin.json'), read('data/ast-schema.json')))
  })

  it('VERSION, SPEC_VERSION and NODE_TYPES', () => {
    expect(VERSION).toBe((JSON.parse(read('package.json')) as { version: string }).version)
    expect(SPEC_VERSION).toEqual({ version: '0.2', commit: (JSON.parse(read('data/spec-pin.json')) as { commit: string }).commit })
    expect(NODE_TYPES.block).toContain('paragraph')
    expect(NODE_TYPES.inline).toContain('text')
    expect(Object.isFrozen(NODE_TYPES.block)).toBe(true)
  })
})

describe('headingId', () => {
  it('gives the id the headingIds option generates for the first heading of that text', () => {
    for (const mode of ['keep-case', 'lower', 'ascii', 'ascii-lower', 'ascii-strict', 'ascii-strict-lower'] as const) {
      for (const text of ['Hello World', 'Ünïcode Straße', '2 Ways', '-', 'a/b: c?']) {
        const html = render(`= ${text}\n`, { headingIds: mode })
        expect(html, `${mode} ${text}`).toContain(`id="${headingId(text, { headingIds: mode })!}"`)
      }
    }
  })

  it('does not add the suffix of a repeated heading, and gives null under off', () => {
    expect(headingId('A')).toBe('A')
    expect(render('= A\n\n= A\n')).toContain('id="A-2"')
    expect(headingId('A', { headingIds: 'off' })).toBeNull()
    expect(() => headingId('A', { headingIds: 'upper' as never })).toThrow(CarveOptionError)
  })
})

describe('includeRegion', () => {
  const text = 'a\n%% #region k\nb\n%% #region inner\nc\n%% #endregion inner\n%% #endregion k\nd\n'

  it('selects the region as the include directive does, with its lines', () => {
    expect(includeRegion(text, 'k')).toEqual({ ok: true, text: 'b\n%% #region inner\nc\n%% #endregion inner\n', start: 3, end: 6 })
    const html = render('{{ f.crv @region:k }}\n', { includes: () => ({ text, id: 'f.crv' }) })
    const selected = includeRegion(text, 'k')
    expect(selected.ok && html === render(selected.text)).toBe(true)
    expect(includeRegion('x\n// #region r\ny\n// #endregion\n', 'r', { code: true })).toEqual({ ok: true, text: 'y\n', start: 3, end: 3 })
    expect(includeRegion('Intro.\n\n%% #region setup\nIn\n%% #endregion\n', 'setup')).toMatchObject({ start: 4, end: 4 })
    expect(includeRegion('%% #region e\n%% #endregion\n', 'e')).toEqual({ ok: true, text: '', start: 2, end: 1 })
  })

  it('gives the reason where the directive reports region_invalid', () => {
    expect(includeRegion(text, 'missing')).toEqual({ ok: false, reason: 'is not opened in the file' })
    expect(includeRegion('// #region r\ny\n', 'r', { code: true })).toMatchObject({ ok: false })
  })
})

describe('includeDependencies ranges and the file resolver', () => {
  it('gives the byte range of each directive site', () => {
    const tree = parse('é\n\n{{ x.crv }}\n', { includes: () => ({ error: 'not_found' }) })
    expect(includeDependencies(tree, { ranges: true })[0]?.range).toEqual({ startOffset: 4, endOffset: 15 })
    expect(includeDependencies(tree)[0]).not.toHaveProperty('range')
  })

  it('maxFileBytes makes a larger file unreadable, allowAbsolute off refuses an absolute path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'carve-resolver-'))
    writeFileSync(join(dir, 'a.crv'), 'four')
    expect(fileSystemResolver(dir, { maxFileBytes: 3 })(request('a.crv'))).toEqual({ error: 'unreadable' })
    expect(fileSystemResolver(dir, { maxFileBytes: 4 })(request('a.crv'))).toHaveProperty('text')
    expect(fileSystemResolver(dir)(request(join(dir, 'a.crv')))).toHaveProperty('text')
    expect(fileSystemResolver(dir, { allowAbsolute: false })(request(join(dir, 'a.crv')))).toEqual({ error: 'outside_root' })
    expect(() => fileSystemResolver(dir, { maxFileBytes: -1 })).toThrow(CarveOptionError)
  })
})
