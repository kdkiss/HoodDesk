import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/dca/route';

vi.mock('@/src/lib/db', () => ({
  prisma: {
    automatedOrder: {
      create: vi.fn().mockResolvedValue({ id: 'test-order-id' }),
    }
  }
}));

vi.mock('@/src/lib/security/authorization', () => ({
  verifyAndConsumeAuthSignature: vi.fn().mockResolvedValue({ valid: true })
}));

describe('DCA Order API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 for invalid payload (e.g. missing signature/invalid address)', async () => {
    const req = new NextRequest('http://localhost:3000/api/orders/dca', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        makerAddress: '0x123',
        tokenIn: '0xabc',
        tokenOut: '0xdef',
        totalAmount: '1000',
        amountPerInterval: '100',
        frequency: 'DAILY'
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid DCA order');
  });
});
