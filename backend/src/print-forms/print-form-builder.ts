import PDFDocument = require('pdfkit');

export interface PrintFormLine {
  position: number;
  productName: string;
  unitName: string;
  quantity: string;
  price: string;
  taxRate: string;
  lineTotal: string;
  taxAmount: string;
  lineTotalWithTax: string;
}

export interface PrintFormData {
  title: string;
  number: string;
  documentDate: string;
  organizationName: string;
  counterpartyName: string;
  lines: PrintFormLine[];
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
}

/**
 * Renders a plain, single-page-per-document print form (1C-style: header
 * fields, a line table, totals) as a PDF buffer. Deliberately simple — no
 * logo/letterhead, no per-tenant templating — that is a later phase; this
 * covers the "can I print this document" gap, not a full print-form
 * designer.
 */
export function buildPrintFormPdf(data: PrintFormData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(data.title, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`No: ${data.number}`);
    doc.text(`Date: ${data.documentDate}`);
    doc.moveDown(0.5);
    doc.text(`Organization: ${data.organizationName}`);
    doc.text(`Counterparty: ${data.counterpartyName}`);
    doc.moveDown(1);

    const colX = [40, 60, 220, 290, 340, 400, 450, 500];
    const headerY = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('#', colX[0], headerY, { width: 18 });
    doc.text('Product', colX[1], headerY, { width: 160 });
    doc.text('Unit', colX[2], headerY, { width: 60 });
    doc.text('Qty', colX[3], headerY, { width: 45, align: 'right' });
    doc.text('Price', colX[4], headerY, { width: 55, align: 'right' });
    doc.text('Tax %', colX[5], headerY, { width: 45, align: 'right' });
    doc.text('Total', colX[6], headerY, { width: 55, align: 'right' });
    doc.text('Tax', colX[7], headerY, { width: 55, align: 'right' });
    doc.font('Helvetica');
    doc.moveDown(0.3);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.2);

    for (const line of data.lines) {
      const y = doc.y;
      doc.fontSize(9);
      doc.text(String(line.position), colX[0], y, { width: 18 });
      doc.text(line.productName, colX[1], y, { width: 160 });
      doc.text(line.unitName, colX[2], y, { width: 60 });
      doc.text(line.quantity, colX[3], y, { width: 45, align: 'right' });
      doc.text(line.price, colX[4], y, { width: 55, align: 'right' });
      doc.text(line.taxRate, colX[5], y, { width: 45, align: 'right' });
      doc.text(line.lineTotal, colX[6], y, { width: 55, align: 'right' });
      doc.text(line.taxAmount, colX[7], y, { width: 55, align: 'right' });
      doc.moveDown(0.4);
      if (doc.y > 760) doc.addPage();
    }

    doc.moveDown(0.3);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(10);
    doc.text(`Subtotal: ${data.subtotal}`, { align: 'right' });
    doc.text(`Tax total: ${data.taxTotal}`, { align: 'right' });
    doc.font('Helvetica-Bold').text(`Grand total: ${data.grandTotal}`, { align: 'right' });
    doc.font('Helvetica');

    doc.end();
  });
}

export interface PaymentOrderPrintData {
  number: string;
  documentDate: string;
  organizationName: string;
  organizationBankName: string;
  organizationAccountIban: string;
  counterpartyName: string;
  counterpartyBankName?: string;
  counterpartyAccountIban?: string;
  amount: string;
  description?: string;
}

/**
 * "Ödəniş Tapşırığı" print form — structurally different from the
 * line-item forms above (payer/payee bank details + amount, not a
 * product table), so it gets its own layout rather than being squeezed
 * through PrintFormData's `lines` shape.
 */
export function buildPaymentOrderPdf(data: PaymentOrderPrintData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text('Payment Order', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`No: ${data.number}`);
    doc.text(`Date: ${data.documentDate}`);
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('Payer');
    doc.font('Helvetica');
    doc.text(data.organizationName);
    doc.text(`Bank: ${data.organizationBankName}`);
    doc.text(`Account: ${data.organizationAccountIban}`);
    doc.moveDown(1);

    doc.font('Helvetica-Bold').text('Payee');
    doc.font('Helvetica');
    doc.text(data.counterpartyName);
    doc.text(`Bank: ${data.counterpartyBankName ?? '—'}`);
    doc.text(`Account: ${data.counterpartyAccountIban ?? '—'}`);
    doc.moveDown(1);

    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').text(`Amount: ${data.amount}`);
    doc.font('Helvetica').fontSize(11);
    doc.moveDown(0.5);
    doc.text(`Purpose of payment: ${data.description ?? '—'}`);

    doc.end();
  });
}
