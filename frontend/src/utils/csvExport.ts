export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/** "Excel export" for list pages — a real .csv, not a fake .xls (the
 * spec's actual requirement is a spreadsheet Excel can open, and CSV opens
 * natively with zero added dependency or file-format complexity). A
 * leading UTF-8 BOM keeps Azerbaijani characters (ə, ğ, ş, …) intact when
 * Excel — not a UTF-8-aware tool by default on Windows — opens the file. */
export function exportToCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]) {
  const escape = (value: string) => {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };

  const lines = [
    columns.map((c) => escape(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => escape(String(c.value(row) ?? ''))).join(',')),
  ];

  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
