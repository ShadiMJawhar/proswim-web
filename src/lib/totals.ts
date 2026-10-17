type Row = Record<string, unknown>;

/** One sum per distinct value of `byKey`, e.g. "LBP 1,200 / USD 300"
 *  (groups sorted so the output is stable). */
export function sumBy(rows: Row[], key: string, byKey: string): string {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const g = String(r[byKey] ?? '');
    sums.set(g, (sums.get(g) ?? 0) + (Number(r[key]) || 0));
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, v]) => `${g} ${v.toLocaleString()}`.trim())
    .join(' / ');
}

/** Legacy PrivatePaymentsList header: "[LBP 1,200] AND [USD 300]" over the
 *  paid amounts by paid currency. LBP only when there are LBP payments (as in
 *  the old system); USD is always shown, "USD 0" when none. */
export function legacyCurrencyTotal(rows: Row[], key: string, curKey: string): string {
  let lbp = 0, usd = 0, hasLbp = false;
  for (const r of rows) {
    const c = String(r[curKey] ?? '').trim().toUpperCase();
    const v = Number(r[key]) || 0;
    if (c === 'LBP') { lbp += v; hasLbp = true; } else if (c === 'USD') usd += v;
  }
  const usdTxt = `[USD ${usd.toLocaleString('en-US')}]`;
  return hasLbp ? `[LBP ${lbp.toLocaleString('en-US')}] AND ${usdTxt}` : usdTxt;
}
