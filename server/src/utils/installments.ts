export interface InstallmentScheduleItem {
  amount: number;
  dueDate: Date;
  installmentNumber: number;
  totalInstallments: number;
}

interface BuildInstallmentScheduleInput {
  totalAmount: number;
  installmentCount: number;
  startDate: Date;
  intervalDays: number;
  upfrontAmount?: number;
}

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildInstallmentSchedule(input: BuildInstallmentScheduleInput): InstallmentScheduleItem[] {
  const { totalAmount, installmentCount, startDate, intervalDays, upfrontAmount = 0 } = input;

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error('totalAmount must be a positive number');
  }
  if (!Number.isInteger(installmentCount) || installmentCount <= 0) {
    throw new Error('installmentCount must be a positive integer');
  }
  if (!Number.isInteger(intervalDays) || intervalDays <= 0) {
    throw new Error('intervalDays must be a positive integer');
  }
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('startDate must be a valid date');
  }
  if (!Number.isFinite(upfrontAmount) || upfrontAmount < 0) {
    throw new Error('upfrontAmount must be a valid positive amount');
  }

  const remainingAmount = roundCurrency(totalAmount - upfrontAmount);
  if (remainingAmount <= 0) {
    throw new Error('remaining installment amount must be positive');
  }

  const baseAmount = Math.floor((remainingAmount / installmentCount) * 100) / 100;
  const remainder = roundCurrency(remainingAmount - (baseAmount * installmentCount));
  const installments: InstallmentScheduleItem[] = [];
  const currentDate = new Date(startDate);

  for (let index = 0; index < installmentCount; index += 1) {
    const amount = index === installmentCount - 1
      ? roundCurrency(baseAmount + remainder)
      : baseAmount;

    installments.push({
      amount,
      dueDate: new Date(currentDate),
      installmentNumber: index + 1,
      totalInstallments: installmentCount,
    });

    currentDate.setDate(currentDate.getDate() + intervalDays);
  }

  return installments;
}
