const TUNISIA_COUNTRY_CODE = '216';

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeTunisiaPhone(value?: string | null): string | null {
  if (!value) return null;

  let digits = digitsOnly(value);
  if (!digits) return null;

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(TUNISIA_COUNTRY_CODE)) return digits;
  if (digits.length === 9 && digits.startsWith('0')) return `${TUNISIA_COUNTRY_CODE}${digits.slice(1)}`;
  if (digits.length === 8) return `${TUNISIA_COUNTRY_CODE}${digits}`;

  return digits.length >= 8 ? digits : null;
}

export function formatTunisiaPhone(value?: string | null): string {
  const normalized = normalizeTunisiaPhone(value);
  if (!normalized) return value?.trim() ?? '';

  if (normalized.startsWith(TUNISIA_COUNTRY_CODE) && normalized.length === 11) {
    return `+216 ${normalized.slice(3, 5)} ${normalized.slice(5, 8)} ${normalized.slice(8)}`;
  }

  return `+${normalized}`;
}

export function buildWhatsAppUrl(phone?: string | null, text?: string): string | null {
  const normalized = normalizeTunisiaPhone(phone);
  if (!normalized) return null;
  const suffix = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${normalized}${suffix}`;
}

export function buildSmsUrl(phone?: string | null, text?: string): string | null {
  const normalized = normalizeTunisiaPhone(phone);
  if (!normalized) return null;
  const suffix = text ? `?body=${encodeURIComponent(text)}` : '';
  return `sms:+${normalized}${suffix}`;
}

export function buildCallUrl(phone?: string | null): string | null {
  const normalized = normalizeTunisiaPhone(phone);
  if (!normalized) return null;
  return `tel:+${normalized}`;
}

export function firstDialablePhone(...phones: Array<string | null | undefined>): string | null {
  for (const phone of phones) {
    const normalized = normalizeTunisiaPhone(phone);
    if (normalized) return normalized;
  }
  return null;
}
