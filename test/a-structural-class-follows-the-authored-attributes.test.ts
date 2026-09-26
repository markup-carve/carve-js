import { describe, expect, it } from 'vitest'
import { carveToHtml, glossary, tocPlacement } from '../src/index.js'

/**
 * A structural class an extension owns goes AFTER every authored attribute, and
 * never ahead of them (markup-carve/carve#2328). Authored attributes keep source
 * order (CARVE-P4-002), and an engine-minted accessible name still trails both.
 */
describe('a structural class follows the authored attributes', () => {
  const toc = (src: string) => carveToHtml(src, { extensions: [tocPlacement()] })
  const openTag = (html: string, tag: string) =>
    html.slice(html.indexOf(`<${tag}`), html.indexOf('>', html.indexOf(`<${tag}`)) + 1)

  it('merges the class at the authored class slot, not at the front', () => {
    const out = toc('{aria-describedby="x" #t .c}\n::: toc "Contents"\n:::\n\n# One\n')
    expect(openTag(out, 'nav')).toBe(
      '<nav aria-describedby="x" id="t" class="toc c" aria-labelledby="adm-1">',
    )
  })

  it('keeps the class slot in the middle when that is where it was written', () => {
    const out = toc('{aria-describedby="x" .c #t}\n::: toc "Contents"\n:::\n\n# One\n')
    expect(openTag(out, 'nav')).toBe(
      '<nav aria-describedby="x" class="toc c" id="t" aria-labelledby="adm-1">',
    )
  })

  // Two authored attributes and no class: "after all authored attributes" and
  // "after the id" only differ here, which is why the divergence survived.
  it('appends the class after every authored attribute when the author wrote none', () => {
    const out = toc('{#t data-x=1}\n::: toc\n:::\n\n# One\n')
    expect(openTag(out, 'nav')).toBe(
      '<nav id="t" data-x="1" class="toc" aria-label="Table of contents">',
    )
  })

  it('appends the class after every authored attribute on a glossary list', () => {
    const out = carveToHtml('{#g data-x=1}\n::: glossary\n:: API\n: Interface\n:::\n', {
      extensions: [glossary()],
    })
    expect(openTag(out, 'dl')).toBe('<dl id="g" data-x="1" class="glossary">')
  })

  it('appends the class after a single authored attribute that names the nav', () => {
    const out = toc('{aria-label="Mine"}\n::: toc "Contents"\n:::\n\n# One\n')
    expect(openTag(out, 'nav')).toBe('<nav aria-label="Mine" class="toc">')
  })

  it('drops a directive-only key without moving what surrounds it', () => {
    const out = toc('# A\n\n{#nav .side depth=1}\n::: toc\n:::\n\n## B\n')
    expect(openTag(out, 'nav')).toBe(
      '<nav id="nav" class="toc side" aria-label="Table of contents">',
    )
    expect(out).not.toContain('depth=')
  })

  it('still dedupes an authored toc class at its own slot', () => {
    const out = toc('{.toc}\n::: toc\n:::\n\n# One\n')
    expect(openTag(out, 'nav')).toBe('<nav class="toc" aria-label="Table of contents">')
  })
})
