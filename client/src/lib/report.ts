export function openPrintableReport(html: string) {
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) return false;

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  return true;
}
