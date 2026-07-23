import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from '@/app/api/orders/[id]/route';
import { prisma } from '@/src/lib/db';
import { verifyAndConsumeAuthSignature } from '@/src/lib/security/authorization';

vi.mock('@/src/lib/db', () => ({
  prisma: {
    automatedOrder: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

vi.mock('@/src/lib/security/authorization', () => ({
  verifyAndConsumeAuthSignature: vi.fn()
}));

describe('Order Actions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 404 if order not found', async () => {
    // @ts-expect-error: mocking prisma
    prisma.automatedOrder.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/orders/test-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', signature: '0xsig' })
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'test-id' }) });
    expect(res.status).toBe(404);
  });

  it('should return 400 for invalid action', async () => {
    // @ts-expect-error: mocking prisma
    prisma.automatedOrder.findUnique.mockResolvedValue({ id: 'test-id', makerAddress: '0x123', status: 'ARMED' });
    vi.mocked(verifyAndConsumeAuthSignature).mockResolvedValue({ valid: true });

    const req = new NextRequest('http://localhost:3000/api/orders/test-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'explode', signature: '0xsig' })
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'test-id' }) });
    expect(res.status).toBe(400);
  });
});
