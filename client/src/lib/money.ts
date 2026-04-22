const fmt = new Intl.NumberFormat('fr-TN', {
  style: 'currency',
  currency: 'TND',
  minimumFractionDigits: 2,
});

export const money = (n: number | undefined | null) => fmt.format(Number(n ?? 0));

export const dateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('fr-TN', { dateStyle: 'short', timeStyle: 'short' }) : '';

export const dateOnly = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('fr-TN') : '';
