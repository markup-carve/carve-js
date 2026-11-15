// C2-A-178, C2-A-179: mechanical changes are indexed by the published upgrade map.
import upgradeMap from '../data/upgrade-map.json' with { type: 'json' }

export interface FieldRule {
  id: string
  types: readonly string[]
  from: string
  to?: string
}

const FIELDS: readonly FieldRule[] = [
  { id: 'T-004', types: ['code', 'math', 'raw_inline'], from: 'cellWraps' },
  { id: 'T-005', types: ['link', 'image'], from: 'rawRef' },
  { id: 'T-012', types: ['definition_list'], from: 'spacing' },
  { id: 'T-012', types: ['definition_list'], from: 'loose' },
  { id: 'T-015', types: ['link', 'image'], from: 'form', to: 'refForm' },
  { id: 'T-016', types: ['xref', 'heading_ref'], from: 'form', to: 'display' },
  { id: 'T-017', types: ['link_reference_definition', 'link', 'image'], from: 'title', to: 'tooltip' },
  { id: 'T-021', types: ['citation_group'], from: 'mode' },
  { id: 'T-023', types: ['task'], from: 'status' },
  { id: 'T-025', types: ['thematic_break'], from: 'marker' },
  { id: 'T-025', types: ['table'], from: 'separatorWidths' },
  { id: 'T-025', types: ['table_row'], from: 'continuationLines' },
  { id: 'T-025', types: ['table_cell'], from: 'sourceContent' },
  { id: 'T-025', types: ['strong'], from: 'boldItalic' },
  { id: 'T-030', types: ['abbreviation', 'abbreviation_def'], from: 'abbr', to: 'key' },
  { id: 'T-030', types: ['footnote', 'footnote_ref', 'link_reference_definition', 'citation_definition'],
    from: 'label', to: 'key' },
  { id: 'T-031', types: ['code_block'], from: 'content', to: 'value' },
  { id: 'T-031', types: ['code_block'], from: 'lang', to: 'syntax' },
  { id: 'T-031', types: ['code_block'], from: 'header', to: 'title' },
  { id: 'T-031', types: ['code_block'], from: 'label', to: 'groupLabel' },
  { id: 'T-031', types: ['div', 'directive', 'admonition'], from: 'label', to: 'groupLabel' },
  { id: 'T-032', types: ['frontmatter', 'raw_block', 'raw_inline', 'literal_inline', 'math'],
    from: 'content', to: 'value' },
  { id: 'T-032', types: ['critic_comment'], from: 'text', to: 'value' },
  { id: 'T-035', types: ['list', 'definition_list', 'citation_group'], from: 'items', to: 'children' },
  { id: 'T-035', types: ['table_row'], from: 'cells', to: 'children' },
  { id: 'T-038', types: ['figure'], from: 'target', to: 'kind' },
  { id: 'T-039', types: ['mention'], from: 'user', to: 'target' },
  { id: 'T-040', types: ['inline_footnote'], from: 'inline', to: 'children' },
  { id: 'T-041', types: ['inline_extension'], from: 'content', to: 'children' },
]

const NODE_TYPES = new Map<string, string>([
  ['rubyPair', 'ruby_pair'], ['heading_ref', 'xref'], ['escaped_text', 'text'],
])

export function renamedType(type: string): string {
  return NODE_TYPES.get(type) ?? type
}

export function fieldRules(type: string): readonly FieldRule[] {
  return FIELDS.filter((rule) => rule.types.includes(type))
}

export function ruleExists(id: string): boolean {
  return upgradeMap.tree.some((row) => row.id === id)
}
