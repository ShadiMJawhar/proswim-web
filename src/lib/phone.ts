// Phone number helpers for the WhatsApp / click-to-copy links (PhoneLink).
//
// Numbers are stored loosely: "03782848", "3782848", "71 566 163",
// "+96171390063", "0096597771428", "961 03782848" (country code + local
// number), "5146884445", "447910492706", plus junk ("0000000", "room517").
// wa.me needs the international number in digits only. Lebanon (+961) is the
// default country: 7- or 8-digit numbers, with or without the leading 0, are
// Lebanese; a 0 right after 961 is dropped.

/** Splits a cell that holds several numbers ("03 123456 / 70 123456",
 *  "a, b", "a; b") into its parts. */
export function splitPhones(raw: string): string[] {
  return raw.split(/\s*(?:\/|;|,|\|| or )\s*/i).map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Digits of the international number for wa.me, or null when the text is
 *  not a usable phone number. */
export function waDigits(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const plus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  if (!d || /^0+$/.test(d)) return null;
  if (plus) return intl(d);
  if (d.startsWith('00')) return intl(d.slice(2));
  if (d.startsWith('961') && d.length >= 10) return intl(d);
  if (d.startsWith('0')) {
    d = d.replace(/^0+/, '');
    return d.length === 7 || d.length === 8 ? '961' + d : null;
  }
  if (d.length === 7 || d.length === 8) return '961' + d;          // Lebanese without the 0
  if (d.length >= 11 && d.length <= 15) return intl(d);             // written with its country code
  return null;                                                      // 9-10 digits: country unknown → copy only
}

/** `d` = international digits without "+" or "00". */
function intl(d: string): string | null {
  if (d.startsWith('961')) {
    const rest = d.slice(3).replace(/^0/, '');
    return rest.length === 7 || rest.length === 8 ? '961' + rest : null;
  }
  if (d.startsWith('1')) return d.length === 11 ? d : null;          // North America: 1 + 10 digits
  return d.length >= 8 && d.length <= 15 ? d : null;
}
