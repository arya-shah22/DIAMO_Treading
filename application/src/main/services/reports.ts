import PDFDocument from 'pdfkit'
import ExcelJS from 'exceljs'
import { writeFileSync } from 'node:fs'
export type ReportRow = Record<string, string | number | boolean | null>
const escape = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
export function printHtml(title: string, company: string, rows: ReportRow[]) {
  const keys = Object.keys(rows[0] ?? {})
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>@page{size:landscape;margin:16mm}body{font:11px Arial,sans-serif;color:#243047}h1{font-size:22px}h2{font-size:15px}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #dfe5eb;text-align:left;overflow-wrap:anywhere}th{background:#edf1f6}thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:20px;color:#667085}</style></head><body><h1>DIAMO</h1><h2>${escape(company)}</h2><p>${escape(title)}</p><table><thead><tr>${keys.map((k) => `<th>${escape(k)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${keys.map((k) => `<td>${escape(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table><footer>Offline report · ${rows.length} rows</footer></body></html>`
}
export async function writeReport(
  format: 'csv' | 'xlsx' | 'pdf',
  path: string,
  title: string,
  company: string,
  rows: ReportRow[],
  fontPath: string,
  logoPath?: string,
) {
  const keys = Object.keys(rows[0] ?? {})
  if (format === 'csv') {
    const quote = (v: unknown) => {
      let s = String(v ?? '')
      if (/^[=+@-]/.test(s)) s = "'" + s
      return '"' + s.replaceAll('"', '""') + '"'
    }
    writeFileSync(
      path,
      '\uFEFF' +
        [
          keys.map(quote).join(','),
          ...rows.map((r) => keys.map((k) => quote(r[k])).join(',')),
        ].join('\r\n'),
    )
    return
  }
  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'DIAMO_TREADING'
    const sheet = workbook.addWorksheet('Report')
    sheet.columns = keys.map((k) => ({
      header: k,
      key: k,
      width: Math.max(15, Math.min(38, k.length + 5)),
    }))
    for (const r of rows) sheet.addRow(r)
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D283A' } }
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: Math.max(1, keys.length) },
    }
    sheet.headerFooter.oddHeader = company + ' — ' + title
    sheet.headerFooter.oddFooter = 'DIAMO | Page &P of &N'
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    await workbook.xlsx.writeFile(path)
    return
  }
  const doc = new PDFDocument({
    margin: 35,
    size: 'A4',
    layout: keys.length > 5 ? 'landscape' : 'portrait',
    bufferPages: true,
  })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c))
  const done = new Promise<void>((resolve, reject) => {
    doc.on('end', resolve)
    doc.on('error', reject)
  })
  doc.font(fontPath)
  const width = doc.page.width - 70
  const cellWidth = width / Math.max(1, keys.length)
  const fontSize = keys.length > 8 ? 7 : 9
  let y = 0
  const heading = () => {
    if (logoPath) doc.image(logoPath, 35, 30, { width: 30, height: 30 })
    doc
      .fillColor('#1d283a')
      .fontSize(18)
      .text(company || 'DIAMO', logoPath ? 75 : 35, 33, { width: width - 40 })
    doc.fontSize(10).fillColor('#64748b').text(title, 35, 72, { width })
    y = Math.max(103, doc.y + 15)
    doc.fillColor('#edf1f6').rect(35, y, width, 28).fill()
    keys.forEach((k, i) =>
      doc
        .fillColor('#263449')
        .fontSize(fontSize)
        .text(k, 40 + i * cellWidth, y + 7, { width: cellWidth - 10, height: 21, ellipsis: true }),
    )
    y += 28
  }
  heading()
  for (const row of rows) {
    const values = keys.map((k) => String(row[k] ?? ''))
    const heights = values.map((v) =>
      doc.fontSize(fontSize).heightOfString(v, { width: cellWidth - 10 }),
    )
    const height = Math.min(160, Math.max(28, ...heights.map((h) => h + 14)))
    if (y + height > doc.page.height - 60) {
      doc.addPage()
      heading()
    }
    values.forEach((v, i) =>
      doc
        .fillColor('#334155')
        .fontSize(fontSize)
        .text(v, 40 + i * cellWidth, y + 7, {
          width: cellWidth - 10,
          height: height - 12,
          ellipsis: true,
        }),
    )
    doc
      .strokeColor('#e4e9f0')
      .lineWidth(0.4)
      .moveTo(35, y + height)
      .lineTo(35 + width, y + height)
      .stroke()
    y += height
  }
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i)
    doc
      .fontSize(8)
      .fillColor('#8490a1')
      .text(
        `DIAMO · ${rows.length} rows · Page ${i + 1} of ${range.count}`,
        35,
        doc.page.height - 40,
        { width, align: 'right', lineBreak: false },
      )
  }
  doc.end()
  await done
  writeFileSync(path, Buffer.concat(chunks))
}
