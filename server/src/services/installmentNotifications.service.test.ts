import { afterEach, describe, expect, it, vi } from 'vitest';
import { Installment } from '../models/Installment.js';

vi.mock('./notification.service.js', () => ({
  createNotification: vi.fn(),
}));

import { refreshInstallmentNotifications } from './installmentNotifications.service.js';

function mockFindResult(rows: unknown[]) {
  const chain: any = {
    sort: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    populate: vi.fn(() => chain),
    lean: vi.fn().mockResolvedValue(rows),
  };
  return chain;
}

describe('installment notification refresh', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('automatically marks overdue pending installments as late', async () => {
    const updateMany = vi
      .spyOn(Installment, 'updateMany')
      .mockResolvedValue({ modifiedCount: 2 } as any);
    const find = vi
      .spyOn(Installment, 'find')
      .mockReturnValueOnce(mockFindResult([]))
      .mockReturnValueOnce(mockFindResult([]))
      .mockReturnValueOnce(mockFindResult([]));

    const result = await refreshInstallmentNotifications(
      new Date('2026-05-09T12:00:00.000Z'),
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
      { $set: { status: 'late' } },
    );
    expect(find).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      lateStatusUpdated: 2,
      overdueChecked: 0,
      dueSoon3dChecked: 0,
      dueSoon7dChecked: 0,
    });
  });
});
