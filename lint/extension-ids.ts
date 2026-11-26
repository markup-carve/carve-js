// C2-X-079: generated from data/extensions.json by lint/generate-extension-ids.ts. Do not edit.

/** The catalog extensions whose row is marked `ids`. */
export const ID_CATALOG_EXTENSIONS: ReadonlySet<string> = new Set([
  "carve.cite",
  "carve.codeGroup",
  "carve.glossary",
  "carve.index",
  "carve.indexTerm",
  "carve.tabs",
])

/** The catalog extensions that generate no ids. */
export const PLAIN_CATALOG_EXTENSIONS: ReadonlySet<string> = new Set([
  "carve.autolink",
  "carve.codeCallouts",
  "carve.colorSwatch",
  "carve.details",
  "carve.externalLinks",
  "carve.fencedRender.abc",
  "carve.fencedRender.chart",
  "carve.fencedRender.d2",
  "carve.fencedRender.dot",
  "carve.fencedRender.graphviz",
  "carve.fencedRender.mermaid",
  "carve.fencedRender.plantuml",
  "carve.fencedRender.puml",
  "carve.fencedRender.vega-lite",
  "carve.fencedRender.wavedrom",
  "carve.headingNumbers",
  "carve.headingPermalinks",
  "carve.headingReference",
  "carve.imgFence.image",
  "carve.imgFence.img",
  "carve.listTable",
  "carve.mathBlock",
  "carve.semanticSpan",
  "carve.smartQuotes",
  "carve.spoiler",
  "carve.spoilerBlock",
  "carve.tab",
  "carve.tabNormalize",
  "carve.term",
  "carve.toc",
  "carve.tocPlacement",
  "carve.wiki",
])

/**
 * C2-X-079, C2-W-150: the registered extensions that generate ids, the run fact `id_extensions`. A definition outside the
 * catalog is a host extension; one named below a catalog row (`carve.codeCallouts.code`) belongs to that row.
 */
export function idExtensions(definitions: readonly { readonly name: string }[] | undefined): string[] {
  return (definitions ?? []).map((definition) => definition.name).filter((name) => ID_CATALOG_EXTENSIONS.has(name)
    || (!PLAIN_CATALOG_EXTENSIONS.has(name) && !PLAIN_CATALOG_EXTENSIONS.has(name.slice(0, Math.max(0, name.lastIndexOf('.'))))))
}
