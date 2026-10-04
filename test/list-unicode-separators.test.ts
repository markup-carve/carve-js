import { expect, it } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

it('preserves Unicode separators in list marker payloads', () => {
  for (const marker of ['- ', '* ', '1. ', 'a. ', '- [x] ', '-{#x} ', '2.{#x} ']) {
    for (const separator of ['\u2028', '\u2029']) {
      for (const ending of ['\n', '\r\n', '\r']) {
        const source = `${marker}before${separator}after${ending}`
        const html = carveToHtml(source)
        const payload = `before${separator}after`
        const opening = marker === 'a. ' ? '<ol type="a">' : marker === '2.{#x} '
          ? '<ol start="2">' : marker === '1. ' ? '<ol>' : '<ul>'
        const li = marker.includes('{#x}') ? '<li id="x">' : '<li>'
        const content = marker === '- [x] '
          ? `<input type="checkbox" checked disabled aria-label="${payload}"> ${payload}` : payload
        const closing = opening.startsWith('<ol') ? '</ol>' : '</ul>'
        expect(html).toBe(`${opening}\n  ${li}${content}</li>\n${closing}`)
      }
    }
  }
})

it('recovers container metadata on list marker lines with Unicode separators', () => {
  for (const marker of ['- ', '1. ', '- [x] ']) {
    const indent = marker === '1. ' ? '   ' : '  '
    for (const separator of ['\u2028', '\u2029']) {
      for (const ending of ['\n', '\r\n', '\r']) {
        const source = `${marker}::: note${separator}x${ending}${indent}# Heading${ending}${indent}:::${ending}`
        const html = carveToHtml(source)
        expect(html).toContain('<li')
        expect(html).toContain('<aside')
        expect(html).toContain('<h1')
        expect(html).not.toContain(':::')
        expect(lintCarve(source).filter(w => w.rule === 'fence-title-syntax')).toHaveLength(1)
      }
    }
  }
})

it('keeps separator payloads in sibling and nested items', () => {
  for (const separator of ['\u2028', '\u2029']) {
    for (const ending of ['\n', '\r\n', '\r']) {
      const sibling = carveToHtml(`- one${ending}-{#x} two${separator}b${ending}- three${ending}`)
      expect(sibling.match(/<li(?:>| )/g)).toHaveLength(3)
      expect(sibling).toContain(`<li id="x">two${separator}b</li>`)
      const nested = carveToHtml(`- a${separator}b${ending}  - c${separator}d${ending}`)
      expect(nested.match(/<ul>/g)).toHaveLength(2)
      expect(nested.match(/<li(?:>| )/g)).toHaveLength(2)
      expect(nested).toContain(`c${separator}d`)
      const loose = carveToHtml(`- a${separator}${ending}${ending}- b${ending}`)
      expect(loose.match(/<li(?:>| )/g)).toHaveLength(2)
      expect(loose).toContain(`<p>a${separator}</p>`)
    }
  }
})
