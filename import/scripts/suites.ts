import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { commonmark } from 'commonmark.json'

export interface Case { id: string, section: string, input: string, html: string }

export function commonmarkCases(): Case[] {
  return commonmark.map((example, index) => ({ id: `CM-${index + 1}`, section: example.section,
    input: example.markdown, html: example.html }))
}

export function gfmCases(): Case[] {
  const lines = readFileSync(join(import.meta.dirname, '../fixtures/gfm-spec.txt'), 'utf8').split('\n')
  const cases: Case[] = []
  let section = 'Introduction'
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? ''
    if (line.startsWith('## ')) section = line.slice(3)
    if (!/^`{3,} example$/u.test(line)) continue
    const fence = line.slice(0, line.indexOf(' example'))
    const input: string[] = []
    const html: string[] = []
    at++
    while (at < lines.length && lines[at] !== '.') input.push((lines[at++] ?? '').replaceAll('→', '\t'))
    at++
    while (at < lines.length && lines[at] !== fence) html.push((lines[at++] ?? '').replaceAll('→', '\t'))
    cases.push({ id: `GFM-${cases.length + 1}`, section, input: `${input.join('\n')}\n`, html: `${html.join('\n')}\n` })
  }
  return cases
}

export function djotCases(): Case[] {
  const directory = join(import.meta.dirname, '../fixtures')
  return readdirSync(directory).filter(file => file.endsWith('.test')).flatMap(file => parseDjotTest(file,
    readFileSync(join(directory, file), 'utf8')))
}

function parseDjotTest(file: string, content: string): Case[] {
  const lines = content.split('\n')
  const cases: Case[] = []
  for (let at = 0; at < lines.length; at++) {
    const opener = lines[at] ?? ''
    if (!/^`{3,}/u.test(opener)) continue
    const fence = opener.match(/^`+/u)?.[0] ?? '```'
    const options = opener.slice(fence.length).trim()
    const start = at + 1
    const input: string[] = []
    at++
    while (at < lines.length && lines[at] !== '.' && lines[at] !== '!') input.push(lines[at++] ?? '')
    at++
    const html: string[] = []
    while (at < lines.length && !(lines[at] ?? '').startsWith(fence)) html.push(lines[at++] ?? '')
    if (!options.includes('a')) cases.push({ id: `DJOT-${file}:${start}`, section: file,
      input: `${input.join('\n')}\n`, html: `${html.join('\n')}\n` })
  }
  return cases
}
