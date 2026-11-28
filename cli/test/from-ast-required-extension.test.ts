import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// carve#6972, C2-X-003: a required extension that `--extensions` registers is known to the tree reader.
const root = join(import.meta.dirname, '../..')
const tree = JSON.stringify({ astVersion: '2.0', type: 'document', srcByteLength: 16,
  stages: ['includeExpansion', 'referenceResolution', 'tableAlignment'],
  extensions: [{ name: 'carve.wiki', required: true, slots: [], version: '1' }],
  children: [{ type: 'paragraph', children: [{ type: 'text', value: 'See ' }, { type: 'inline_extension', name: 'carve.wiki',
    version: '1', props: { target: 'Main' }, children: [], fallback: [{ type: 'text', value: 'Main' }],
    source: { form: 'inline', name: 'wiki', body: 'Main' } }] }] })

function cli(args: string[]): { status: number | null, stdout: string, stderr: string } {
  const result = spawnSync(process.execPath, [join(root, 'cli/main.ts'), ...args, '-'], { cwd: root, input: tree, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('--from-ast with a required extension', () => {
  it('renders the tree when --extensions registers it', () => {
    const result = cli(['render', '--from-ast', '--extensions', '["carve.wiki"]'])
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('<p>See <a href="main" class="wikilink" data-wikilink="Main">Main</a></p>\n')
    expect(result.status).toBe(0)
  })

  it('formats the tree when --extensions registers it', () => {
    const result = cli(['fmt', '--from-ast', '--extensions', '["carve.wiki"]'])
    expect(result.stdout).toBe('See :wiki[Main]\n')
    expect(result.status).toBe(0)
  })

  for (const extensions of [undefined, '["carve.details"]']) {
    it(`refuses it with ${extensions ?? 'no --extensions'}`, () => {
      const result = cli(['render', '--from-ast', ...(extensions === undefined ? [] : ['--extensions', extensions])])
      expect(result.stderr).toBe('carve[ast-json-invalid]: /extensions/0: an unknown required extension\n')
      expect(result.status).toBe(2)
    })
  }
})
