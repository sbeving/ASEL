import {
  buildCallUrl,
  buildSmsUrl,
  buildWhatsAppUrl,
  firstDialablePhone,
  formatTunisiaPhone,
} from '../lib/contact';

interface ContactActionsProps {
  phone?: string | null;
  phone2?: string | null;
  message?: string;
  whatsappText?: string;
  smsText?: string;
  compact?: boolean;
  className?: string;
}

export function ContactActions({
  phone,
  phone2,
  message,
  whatsappText,
  smsText,
  compact = false,
  className = '',
}: ContactActionsProps) {
  const primaryPhone = firstDialablePhone(phone, phone2);
  if (!primaryPhone) return null;

  const whatsappUrl = buildWhatsAppUrl(primaryPhone, whatsappText ?? message);
  const smsUrl = buildSmsUrl(primaryPhone, smsText ?? message);
  const callUrl = buildCallUrl(primaryPhone);
  const title = [phone, phone2]
    .map((value) => formatTunisiaPhone(value))
    .filter(Boolean)
    .join(' · ');
  const baseClasses = compact
    ? 'inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors'
    : 'inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors';
  const whatsappLabel = compact ? 'WA' : 'WhatsApp';
  const callLabel = compact ? 'Tel' : 'Appeler';

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`.trim()}>
      {whatsappUrl && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          title={title || 'WhatsApp'}
          className={`${baseClasses} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
        >
          {whatsappLabel}
        </a>
      )}
      {smsUrl && (
        <a
          href={smsUrl}
          title={title || 'SMS'}
          className={`${baseClasses} border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100`}
        >
          SMS
        </a>
      )}
      {callUrl && (
        <a
          href={callUrl}
          title={title || 'Appeler'}
          className={`${baseClasses} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
        >
          {callLabel}
        </a>
      )}
    </div>
  );
}
