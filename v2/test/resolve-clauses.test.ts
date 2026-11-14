// The clauses on resolution: references and their keys (C2-A-103 to C2-A-117), the results that
// are published in the tree (C2-A-133 to C2-A-135), and the rules of the HTML document that give
// those results (heading ids, footnote numbers, caption numbers, cross-references).
import { describe, expect, it } from 'vitest'
import { type FootnoteRefNode, type LinkNode, type Node } from '../src/ast.ts'
import { treesEqual } from '../src/ast-json.ts'
import { CarveOptionError, readOptions } from '../src/options.ts'
import { resolve } from '../src/resolve.ts'
import { slugify } from '../src/slug.ts'
import { childrenOf, fieldOf, inlinesOf, ofType } from './support/nodes.ts'
import { at, documentOf, paragraph, resolved, resolvedInlines, text, tree } from './support/tree.ts'

function ids(src: string, mode: Parameters<typeof resolved>[1] = 'keep-case'): (string | undefined)[] {
  return resolved(src, mode).document.children!.filter((node) => node.type === 'heading').map((node) => node.attrs?.id ?? node.generatedId)
}

describe('references', () => {
  it('C2-A-103: a reference use and a definition carry key and namespace; a direct link carries neither', () => {
    expect(resolvedInlines('[a][b] [^n] </#x> [c](d)').filter((node) => node.type !== 'text').map((node) => [node.type, fieldOf(node, 'namespace')])).toEqual([
      ['link', 'link'], ['footnote_ref', 'footnote'], ['xref', 'heading'], ['link', undefined],
    ])
  })

  it('C2-A-104: the key is the folded label, and case is kept', () => {
    expect(resolvedInlines('[x][a  b\n c]\n\n[a b c]: /u')[0]).toEqual({ type: 'link', key: 'a b c', namespace: 'link', form: 'full', href: '/u', children: [text('x')] })
    expect(ofType(resolvedInlines('[x][A]\n\n[a]: /u')[0], 'link').href).toBeUndefined()
  })

  it('C2-A-105: a reference carries its form, exactly when it carries a key', () => {
    expect(resolvedInlines('[a][b] [c][] [d](e)').filter((node) => node.type === 'link').map((node) => node.form)).toEqual(['full', 'collapsed', undefined])
    expect(ofType(resolvedInlines('[c *d*][]')[0], 'link').key).toBe('c *d*')
  })

  it('C2-A-106: a resolution result is added beside the authored construct', () => {
    expect(resolvedInlines('[a][b]\n\n[b]: /u')[0]).toEqual({ type: 'link', key: 'b', namespace: 'link', form: 'full', href: '/u', children: [text('a')] })
  })

  it('C2-A-107: an absent destination means unresolved, and the empty string a destination that is empty', () => {
    expect(ofType(resolvedInlines('[a][nope]')[0], 'link').href).toBeUndefined()
    expect(ofType(resolvedInlines('[a]()')[0], 'link').href).toBe('')
    expect(ofType(resolvedInlines('![a][nope] x')[0], 'image').src).toBeUndefined()
  })

  it('C2-A-108: an unresolved reference is still a link or an image node with its children, key, form and attrs', () => {
    expect(resolvedInlines('[*a*][nope]{.c}')[0]).toEqual({
      type: 'link', key: 'nope', namespace: 'link', form: 'full', children: [{ type: 'strong', children: [text('a')] }], attrs: { classes: ['c'] },
    })
    expect(resolvedInlines('![a][nope] x')[0]).toEqual({ type: 'image', key: 'nope', namespace: 'link', form: 'full', alt: 'a' })
  })

  it('C2-A-109: a link reference is looked up in the definitions first and then in the headings; an image is not', () => {
    expect(resolvedInlines('# Intro\n\n[Intro][] [x][Intro] ![i][Intro]', 1).map((node) => fieldOf(node, 'href') ?? fieldOf(node, 'src'))).toEqual(['#Intro', undefined, '#Intro', undefined, undefined])
    expect(ofType(resolvedInlines('# Intro\n\n[Intro][]\n\n[Intro]: /u', 1)[0], 'link').href).toBe('/u')
  })

  it('C2-I-084: a heading matches by the folded source of its text or by its plain text; the first one wins', () => {
    expect(resolvedInlines('# A *b* `c`\n\n[A *b* `c`][] [x][A b c]', 1).map((node) => fieldOf(node, 'href'))).toEqual(['#A-b-c', undefined, '#A-b-c'])
    expect(ofType(resolvedInlines('# T\n\n# T\n\n[T][]', 2)[0], 'link').href).toBe('#T')
    expect(at(resolved('# T\n\n[T][]', 'off').document, 'children.1.children.0.href')).toBeUndefined()
    expect(at(resolved('{#t}\n# T\n\n[T][]', 'off').document, 'children.1.children.0.href')).toBe('#t')
  })

  it('C2-A-110: the attributes of a definition are not written into the reference', () => {
    expect(resolvedInlines('[a][b]{.own}\n\n{.def}\n[b]: /u')[0]!.attrs).toEqual({ classes: ['own'] })
  })

  it('C2-A-116: a cross-reference is an xref; resolution adds href, and an unresolved one omits it', () => {
    expect(resolvedInlines('# T\n\n</#T> </#none>', 1).filter((node) => node.type === 'xref')).toEqual([
      { type: 'xref', key: 'T', namespace: 'heading', href: '#T' }, { type: 'xref', key: 'none', namespace: 'heading' },
    ])
  })

  it('C2-A-117: a footnote reference carries its number once resolved, and an abbreviation its expansion', () => {
    expect(resolvedInlines('a[^n] b[^zz]\n\n[^n]: x').filter((node) => node.type === 'footnote_ref')).toEqual([
      { type: 'footnote_ref', key: 'n', namespace: 'footnote', number: 1 }, { type: 'footnote_ref', key: 'zz', namespace: 'footnote' },
    ])
  })

  it('C2-A-100: an inline footnote takes its number in the one sequence', () => {
    expect(resolvedInlines('a^[x] b[^n]\n\n[^n]: y').filter((node) => node.type !== 'text').map((node) => fieldOf(node, 'number'))).toEqual([1, 2])
  })
})

describe('resolution results', () => {
  it('C2-A-133, C2-A-162: the results are in the tree and take no part in equality', () => {
    const src = '# T\n\n[T][] a[^n] </#T>\n\n| a |\n^ Table #\n\n[^n]: x'
    const { document } = resolved(src)
    expect(JSON.stringify(document)).toContain('"generatedId":"T"')
    expect(treesEqual(document, tree(src))).toBe(true)
  })

  it('C2-A-134: a generated heading id is published in generatedId and never in attrs.id', () => {
    expect(resolved('# One two').document.children![0]).toEqual({ type: 'heading', level: 1, children: [text('One two')], generatedId: 'One-two' })
    expect(ofType(resolved('{#x}\n# T').document.children[0], 'heading').generatedId).toBeUndefined()
    expect(ofType(resolved('# T', 'off').document.children[0], 'heading').generatedId).toBeUndefined()
  })

  it('C2-A-025: a walker visits the children first and then the secondary slots, and no value, data or payload', () => {
    const { document, resolution } = resolved('| a[^x] |\n^ c[^y] `[^z]`\n\n[^x]: X\n[^y]: Y\n[^z]: Z')
    expect(resolution.notes.map((note) => note.definition!.key)).toEqual(['x', 'y'])
    const hidden: FootnoteRefNode = { type: 'footnote_ref', key: 'x', namespace: 'footnote' }
    const supplied = documentOf({ ...paragraph(), data: { 'org.example.x': hidden } }, document.children![1]!)
    expect(resolve(supplied, 'keep-case', null).notes).toEqual([])
    expect(hidden.number).toBeUndefined()
  })

  it('C2-A-159: a tree that was built without source has no position, and resolution adds none', () => {
    const supplied = documentOf({ type: 'heading', level: 1, children: [text('T')] }, paragraph({ type: 'xref', key: 'T', namespace: 'heading' }))
    resolve(supplied, 'keep-case', null)
    expect(JSON.stringify(supplied)).not.toContain('pos')
    expect(at(supplied, 'children.1.children.0.href')).toBe('#T')
  })

  it('C2-A-135: the root names the stages that ran', () => {
    expect(resolved('a').document.stages).toEqual(['referenceResolution', 'tableAlignment'])
  })

  it('C2-A-089, C2-B-213: resolvedAlign is the mark of the last head cell of the column that has one, or else the alignment the column spells', () => {
    expect(ofType(resolved('|={>} a |= b |\n|={~} c |= d |\n| e | f |').document.children[0], 'table').columns).toEqual([
      { type: 'table_column', resolvedAlign: 'center' }, { type: 'table_column' },
    ])
    expect(ofType(resolved('{aligns="left,center"}\n|={>} a |= b |').document.children[0], 'table').columns).toEqual([
      { type: 'table_column', align: 'left', authored: true, resolvedAlign: 'right' },
      { type: 'table_column', align: 'center', authored: true, resolvedAlign: 'center' },
    ])
  })

  it('C2-A-005, C2-A-039, C2-A-172, C2-A-173: a duplicate id is reported in the diagnostics record with a code, a severity, a message and a channel, and nothing in the tree marks it', () => {
    const { document, resolution } = resolved('{#a}\nx\n\n{#a}\ny')
    expect(resolution.diagnostics).toEqual([{ code: 'duplicate-id', severity: 'warning', channel: 'parse', message: 'Duplicate id "a": the repeated HTML id is invalid, and cross-references to it resolve to the first occurrence.' }])
    expect(document.children!.map((node) => node.attrs)).toEqual([{ id: 'a' }, { id: 'a' }])
  })

  it('C2-A-080, C2-B-085: the first of two definitions wins, and the later one is reported', () => {
    const { document, resolution } = resolved('[x][l] a[^n]\n\n[l]: /one\n[l]: /two\n[^n]: one\n[^n]: two')
    expect(at(document, 'children.0.children.0.href')).toBe('/one')
    expect(resolution.notes[0]!.definition).toBe(document.children![3])
    expect(resolution.diagnostics.map((entry) => entry.code)).toEqual(['duplicate-link-reference-definition', 'duplicate-footnote-definition'])
  })

  it('a supplied tree resolves by the plain text of its headings, and keeps a destination an earlier resolution published', () => {
    const link: LinkNode = { type: 'link', key: 'T', namespace: 'link', form: 'collapsed', children: [text('T')] }
    const supplied = documentOf({ type: 'heading', level: 1, children: [text('T')] }, paragraph(link))
    resolve(supplied, 'keep-case', null)
    expect(link.href).toBe('#T')
    const kept: LinkNode = { type: 'link', key: 'gone', namespace: 'link', form: 'full', href: '#x', children: [] }
    resolve({ ...documentOf(paragraph(kept)), stages: ['referenceResolution'] }, 'keep-case', null)
    expect(kept.href).toBe('#x')
    resolve(documentOf(paragraph(kept)), 'keep-case', null)
    expect(kept.href).toBeUndefined()
  })
})

describe('heading ids', () => {
  it('C2-H-022: the slug keeps case and non-ASCII letters, and a run of other characters is one hyphen', () => {
    expect(slugify('Two  words, here!', 'keep-case')).toBe('Two-words-here')
    expect(slugify('Café 日本語', 'keep-case')).toBe('Café-日本語')
    expect(slugify('Don’t → go', 'keep-case')).toBe('Don-t-go')
    expect(slugify('2024 plan', 'keep-case')).toBe('s-2024-plan')
    expect(slugify('!!!', 'keep-case')).toBe('s')
    expect(slugify('é', 'keep-case')).toBe('é')
  })

  it('C2-H-022, C2-H-131: lower folds the case and ascii also transliterates', () => {
    expect(slugify('Café Straße', 'lower')).toBe('café-straße')
    expect(slugify('Café Straße', 'ascii')).toBe('cafe-strasse')
    expect(ids('# Café', 'lower')).toEqual(['café'])
    expect(() => readOptions({ headingIds: 'upper' }, 'parse')).toThrow(CarveOptionError)
  })

  it('C2-H-022: the plain text of a heading leaves out a comment, a footnote reference and a symbol', () => {
    expect(ids('# x {# c #} y[^n] :s: `z` /w/ ![alt](u)')).toEqual(['x-y-z-w-alt'])
  })

  it('C2-H-024: authored ids are reserved first, and a slug that is taken gets the suffix -2, then -3', () => {
    expect(ids('# One\n\n# One\n\n# One')).toEqual(['One', 'One-2', 'One-3'])
    expect(ids('# One\n\n{#One}\n# Two')).toEqual(['One-2', 'One'])
    expect(ids('# One\n\n[x]{#One-2}\n\n# One')).toEqual(['One', 'One-3'])
    expect(ids('{#a}\n# T\n\n{#a}\n# U')).toEqual(['a', 'a'])
  })

  it('C2-H-024: the id of an unresolved reference is text and reserves nothing', () => {
    expect(ids('[x][nope]{#One}\n\n# One')).toEqual(['One'])
  })

  it('C2-H-025: the headings of a footnote body take their ids after those of the document body, in the order of the numbers', () => {
    const { document } = resolved('a[^b] c[^a]\n\n[^a]: # T\n\n[^b]: # T\n\n[^c]: # T\n\n# T')
    const noteHeading = (index: number): unknown => at(document, `children.${index}.children.0.generatedId`)
    expect([noteHeading(1), noteHeading(2), noteHeading(3), ofType(document.children[4], 'heading').generatedId]).toEqual(['T-3', 'T-2', undefined, 'T'])
  })
})

describe('footnotes, captions and cross-references', () => {
  it('C2-H-087: footnotes are numbered in the order of their first reference, and a later reference reuses the number', () => {
    const { document, resolution } = resolved('a[^b] c^[i] d[^a] e[^b]\n\n[^a]: A\n[^b]: B')
    expect(inlinesOf(document.children[0]).filter((node) => fieldOf(node, 'number') !== undefined).map((node) => fieldOf(node, 'number'))).toEqual([1, 2, 3, 1])
    expect(resolution.notes.map((note) => note.refIds)).toEqual([['fnref1', 'fnref1-2'], ['fnref2'], ['fnref3']])
  })

  it('C2-H-086: a footnote reference inside an unresolved reference or inside a note is an ordinary one', () => {
    expect(resolved('[a[^n]][nope] ^[b[^m]]\n\n[^n]: N\n[^m]: M').resolution.notes.map((note) => note.number)).toEqual([1, 2, 3])
  })

  it('C2-H-088: an id the author wrote on the reference replaces the generated one', () => {
    expect(resolved('a[^n]{#mine}\n\n[^n]: N').resolution.notes[0]!.refIds).toEqual(['mine'])
  })

  it('C2-H-066: a caption takes the next number of the sequence its label selects; a panel caption takes none', () => {
    const src = '| a |\n^ Table #: x\n\n![a](b)\n^ Figure #: y\n\n| a |\n^ Table #: z\n\n::: figure\n![a](b)\n^ Figure #: p\n:::\n^ Figure #: g'
    const numbers = (node: Node | undefined): unknown => at(node, 'caption.children.0.children.1.n')
    const { document } = resolved(src)
    expect(document.children!.map(numbers)).toEqual([1, 1, 2, 2])
    expect(numbers(childrenOf(document.children[3])[0])).toBeUndefined()
  })

  it('C2-H-095, C2-H-096: a cross-reference resolves against the ids of headings and of numbered captions, without case folding', () => {
    const { document, resolution } = resolved('{#t}\n| a |\n^ Table #: x\n\n# Head *ing*\n\n</#t> </#Head-ing> </#head-ing> </#T>')
    const xrefs = inlinesOf(document.children[2]).filter((node) => node.type === 'xref')
    expect(xrefs.map((node) => node.href)).toEqual(['#t', '#Head-ing', undefined, undefined])
    expect(xrefs.map((node) => resolution.xrefText.get(node))).toEqual(['Table 1', 'Head ing', undefined, undefined])
  })
})
