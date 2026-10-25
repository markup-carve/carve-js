import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse, toAstJson, migrateAstJson, fromAstJson, AstJsonMigrationInputError } from '../src/index.js'

const oldBuild = '../carve-js-base-ast2/dist/index.js'
const old = existsSync(oldBuild) ? await import(pathToFileURL(resolve(oldBuild)).href) : undefined
const migrateSource = (source: string) => migrateAstJson(old!.toAstJson(old!.parse(source)), { source })

describe('AST 1.2 migration', () => {
  it('returns an existing 2.0 tree unchanged', () => {
    const tree = toAstJson(parse('text'))
    expect(migrateAstJson(tree)).toEqual({ tree, losses: [] })
  })
  it('rejects invalid input with a typed error', () => {
    expect(() => migrateAstJson({ type: 'wrong' })).toThrow(AstJsonMigrationInputError)
  })
  it.skipIf(!old)('converts astral offsets', () => {
    const source = '😀\n\ntext'
    expect(migrateSource(source)).toEqual({ tree: toAstJson(parse(source)), losses: [] })
  })
  it.skipIf(!old)('migrates short inline extension names', () => {
    const source = ':kbd[Ctrl]'
    const result = migrateSource(source)
    expect(result.tree).toEqual(toAstJson(parse(source)))
  })
  it.skipIf(!old)('migrates unresolved references', () => {
    const source = '[label][missing]'
    expect(migrateSource(source).tree).toEqual(toAstJson(parse(source)))
  })
  it.skipIf(!old)('migrates table row groups', () => {
    const source = '| a | b |\n|---|---|\n| c | d |'
    expect(migrateSource(source).tree).toEqual(toAstJson(parse(source)))
  })
  it.skipIf(!old)('migrates task lists', () => {
    const source = '- [x] done\n- [ ] todo'
    expect(migrateSource(source).tree).toEqual(toAstJson(parse(source)))
    expect(() => fromAstJson(migrateSource(source).tree)).not.toThrow()
  })
  it.skipIf(!old)('passes every corpus document', () => {
    const files = readdirSync('spec/tests/corpus').filter(file => file.endsWith('.crv'))
    const failures: string[] = []
    const strip = (value: unknown, paths: string[], path = ''): unknown => {
      if (Array.isArray(value)) return value.map((item, index) => strip(item, paths, `${path}/${index}`))
      if (!value || typeof value !== 'object') return value
      return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
        if (key === 'pos' || key === 'cellWraps' || key === 'segments') { paths.push(`${path}/${key}`); return [] }
        return [[key, strip(child, paths, `${path}/${key}`)]]
      }))
    }
    for (const file of files) {
      const source = readFileSync(`spec/tests/corpus/${file}`, 'utf8')
      try {
        const prior = old!.toAstJson(old!.parse(source))
        const expected = toAstJson(parse(source))
        const withSource = migrateAstJson(prior, { source })
        const without = migrateAstJson(prior)
        const paths: string[] = []
        const expectedWithout = strip(expected, paths)
        if (JSON.stringify(withSource.tree) !== JSON.stringify(expected)) {
          // Compare by structure because the root field order can differ.
          expect(withSource.tree).toEqual(expected)
        }
        expect(withSource.losses).toEqual([])
        expect(without.tree).toEqual(expectedWithout)
        expect(without.losses.map(loss => loss.path).sort()).toEqual(paths.sort())
        expect(() => fromAstJson(withSource.tree)).not.toThrow()
        expect(() => fromAstJson(without.tree)).not.toThrow()
      } catch (error) { failures.push(`${file}: ${(error as Error).message.split('\n')[0]}`) }
    }
    expect(failures).toEqual([])
  }, 120_000)
})

describe('extension declarations', () => {
  it('declare the version the extension node carries', () => {
    const tree12 = { type: 'document', astVersion: '1.2', srcByteLength: 0, children: [{ type: 'block_extension', name: 'org.example.chart', version: '1', fallback: { type: 'paragraph', children: [{ type: 'text', value: 'chart' }] } }] }
    const { tree } = migrateAstJson(tree12 as never)
    expect((tree as unknown as { extensions: unknown[] }).extensions).toEqual([{ name: 'org.example.chart', version: '1', required: false }])
  })
})

describe('unversioned extensions', () => {
  it('declare no placeholder version', () => {
    const tree12 = { type: 'document', astVersion: '1.2', srcByteLength: 0, children: [{ type: 'block_extension', name: 'org.example.chart', fallback: { type: 'paragraph', children: [{ type: 'text', value: 'chart' }] } }] }
    const { tree } = migrateAstJson(tree12 as never)
    expect((tree as unknown as { extensions: unknown[] }).extensions).toEqual([{ name: 'org.example.chart', required: false }])
  })
})
