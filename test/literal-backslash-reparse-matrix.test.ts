import { describe, expect, it } from 'vitest'
import { carveToCarve, parse, toAstJson } from '../src/index.js'

const followers = [
  ...`!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`,
  ' ', '\t', '\n', '', 'a', 'Z', '0', 'é', '中',
]

const hosts: Record<string, (value: string) => string> = {
  paragraph: value => `x${value}y\n`,
  emphasis: value => `/x${value}y/\n`,
  link: value => `[x${value}y](url)\n`,
  table: value => `| x${value}y |\n`,
  heading: value => `# x${value}y\n`,
  list: value => `- x${value}y\n`,
}

function tree(value: unknown): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (const entry of value) {
      const child = tree(entry)
      const previous = out.at(-1)
      if (isText(child) && isText(previous)) previous.value += child.value
      else out.push(child)
    }
    return out
  }
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) {
    if (key === 'pos' || key === 'srcByteLength') continue
    out[key] = key === 'attrs' ? field : tree(field)
  }
  if (out.type === 'escaped_text') out.type = 'text'
  return out
}

function isText(value: unknown): value is { type: 'text'; value: string } {
  return value !== null && typeof value === 'object' &&
    (value as { type?: string }).type === 'text' &&
    Object.keys(value).every(key => key === 'type' || key === 'value')
}

describe('literal backslash decisions use the reparse in every inline host', () => {
  it('keeps a literal backslash before a space', () => {
    expect(carveToCarve('a\\\\ b\n')).toBe('a\\\\ b\n')
  })

  for (const [host, wrap] of Object.entries(hosts)) {
    it(host, () => {
      for (const follower of followers) {
        for (const slashes of ['\\', '\\\\']) {
          const source = wrap(`${slashes}${follower}`)
          const written = carveToCarve(source)
          const label = `${host} after ${JSON.stringify(follower)} with ${slashes.length} slash(es)`
          expect(tree(toAstJson(parse(written))), label).toEqual(tree(toAstJson(parse(source))))
          expect(carveToCarve(written), label).toBe(written)
        }
      }
    })
  }
})
