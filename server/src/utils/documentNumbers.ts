export function cashFlowReceiptSequenceKey(date = new Date()): string {
  const year = date.getFullYear();
  return `cashflow-receipt:${year}`;
}

export function formatCashFlowReceiptNumber(date = new Date(), sequence: number): string {
  const year = date.getFullYear();
  const safeSequence = Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 1;
  return `REC-${year}-${String(safeSequence).padStart(6, '0')}`;
}

export function installmentReceiptSequenceKey(date = new Date()): string {
  const year = date.getFullYear();
  return `installment-receipt:${year}`;
}

export function formatInstallmentReceiptNumber(date = new Date(), sequence: number): string {
  const year = date.getFullYear();
  const safeSequence = Number.isFinite(sequence) && sequence > 0 ? Math.floor(sequence) : 1;
  return `ECH-${year}-${String(safeSequence).padStart(6, '0')}`;
}
