/** Legacy GetCodedInvoiceID for private payments:
 *  234 → "Prv-234", 1234 → "Prv-A-234", 12345 → "Prv-AB-345". */
export function codedInvoiceId(id: number): string {
  let coded = `Prv-${id}`;
  if (id > 1000) { const t = Math.floor(id / 1000); coded = `Prv-${String.fromCharCode(64 + t)}-${id - t * 1000}`; }
  if (id > 10000) {
    const tt = Math.floor(id / 10000), t = Math.floor((id - 10000 * tt) / 1000);
    coded = `Prv-${String.fromCharCode(64 + tt)}${String.fromCharCode(64 + t)}-${id - tt * 10000 - t * 1000}`;
  }
  return coded;
}
