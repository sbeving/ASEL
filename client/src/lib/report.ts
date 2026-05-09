export function safeReportFilename(label: string, extension = 'html') {
  const safeLabel = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asel-report';
  return `${safeLabel}-${new Date().toISOString().slice(0, 10)}.${extension.replace(/^\./, '')}`;
}

export function downloadHtmlReport(html: string, filename = safeReportFilename('asel-report')) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);

  return true;
}

export const openPrintableReport = downloadHtmlReport;
