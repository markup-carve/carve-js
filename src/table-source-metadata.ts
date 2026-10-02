import type { Attrs, Table, TableColumn, TableRowGroups } from './ast.js'

function shiftDecimal(value: string, places: number): string | undefined {
  const match = /^([+]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/.exec(value.trim())
  if (!match) return undefined
  const mantissa = match[2]!
  const digits = mantissa.replace('.', '')
  const point = (mantissa.includes('.') ? mantissa.indexOf('.') : mantissa.length) + Number(match[3] ?? 0) + places
  if (!Number.isSafeInteger(point) || Math.abs(point) > 1000) return undefined
  const shifted = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length ? `${digits}${'0'.repeat(point - digits.length)}`
      : `${digits.slice(0, point)}.${digits.slice(point)}`
  return shifted.replace(/^0+(?=\d)/, '')
}

function positional(value: string | undefined, allowed: Set<string>): Array<string | undefined> {
  return value?.split(',').map((raw) => {
    const item = raw.trim()
    return allowed.has(item) ? item : undefined
  }) ?? []
}

export function tableColumnsFromAttrs(attrs: Attrs | undefined): TableColumn[] | undefined {
  const kv = attrs?.keyValues
  if (!kv) return undefined
  const aligns = positional(kv.aligns, new Set(['left', 'right', 'center']))
  const valigns = positional(kv.valigns, new Set(['top', 'middle', 'bottom']))
  const widths = kv.widths?.split(',').map((raw) => {
    const value = Number(raw.trim())
    return Number.isFinite(value) && value > 0 && value <= 100 ? Number(shiftDecimal(raw, -2) ?? String(value / 100)) : undefined
  }) ?? []
  const count = Math.max(aligns.length, valigns.length, widths.length)
  return count > 0 ? Array.from({ length: count }, (_, i) => ({
    ...(aligns[i] ? { align: aligns[i] as NonNullable<TableColumn['align']> } : {}),
    ...(valigns[i] ? { valign: valigns[i] as NonNullable<TableColumn['valign']> } : {}),
    ...(widths[i] ? { width: widths[i] } : {}),
  })) : undefined
}

export function tableRowGroupsFromAttrs(attrs: Attrs | undefined, rows: number): TableRowGroups | undefined {
  const kv = attrs?.keyValues
  if (kv?.['header-rows'] === undefined && kv?.['footer-rows'] === undefined) return undefined
  const rowCount = (value: string | undefined): number | undefined => {
    if (value === undefined) return 0
    if (value.trim() === '') return 1
    return /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined
  }
  const headRows = rowCount(kv?.['header-rows'])
  const footRows = rowCount(kv?.['footer-rows'])
  if (headRows === undefined || footRows === undefined || headRows + footRows > rows) return undefined
  return { headRows, bodies: [{ headRows: 0, bodyRows: rows - headRows - footRows }], footRows }
}

/** Add source spellings for table metadata without replacing authored attributes. */
export function tableSourceAttrs(table: Table): Attrs | undefined {
  const keyValues = { ...(table.attrs?.keyValues ?? {}) }
  const columns = table.columns
  if (columns?.length) {
    const join = (field: 'align' | 'valign', key: string): void => {
      if (keyValues[key] === undefined && columns.some((column) => column[field] !== undefined)) {
        keyValues[key] = columns.map((column) => column[field] ?? '').join(',')
      }
    }
    join('align', 'aligns')
    join('valign', 'valigns')
    if (keyValues.widths === undefined && columns.some((column) => column.width !== undefined)) {
      keyValues.widths = columns.map((column) => column.width === undefined ? '' : (shiftDecimal(String(column.width), 2) ?? String(column.width * 100))).join(',')
    }
    if (keyValues.aligns === undefined && keyValues.valigns === undefined && keyValues.widths === undefined) {
      keyValues.aligns = columns.map(() => '').join(',')
    }
  }
  const groups = table.rowGroups
  const body = groups?.bodies[0]
  if (groups && groups.bodies.length === 1 && body?.headRows === 0 && body.rowHeadColumns === undefined) {
    if (keyValues['header-rows'] === undefined && groups.headRows > 0) keyValues['header-rows'] = String(groups.headRows)
    if (keyValues['footer-rows'] === undefined && groups.footRows > 0) keyValues['footer-rows'] = String(groups.footRows)
    if (keyValues['header-rows'] === undefined && keyValues['footer-rows'] === undefined) keyValues['header-rows'] = '0'
  }
  return Object.keys(keyValues).length ? { ...(table.attrs ?? {}), keyValues } : table.attrs
}

export function preservesTableRowGroups(table: Table, attrs: Attrs | undefined): boolean {
  const groups = table.rowGroups!
  const rebuilt = tableRowGroupsFromAttrs(attrs, table.rows.length)
  const body = groups.bodies[0]
  return rebuilt !== undefined && groups.headRows === rebuilt.headRows && groups.footRows === rebuilt.footRows
    && groups.bodies.length === 1 && body !== undefined && body.headRows === 0
    && body.bodyRows === rebuilt.bodies[0]!.bodyRows && body.rowHeadColumns === undefined
}

export function preservesTableColumns(table: Table, attrs: Attrs | undefined): boolean {
  const columns = table.columns!
  const rebuilt = tableColumnsFromAttrs(attrs)
  return rebuilt !== undefined && rebuilt.length === columns.length && columns.every((column, i) => {
    const other = rebuilt[i]!
    return column.align === other.align && column.valign === other.valign && column.width === other.width
  })
}
