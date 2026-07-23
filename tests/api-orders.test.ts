import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/route';

vi.mock('@/src/lib/db', () => ({
  prisma: {
    limitOrder: {
      create: vi.fn().mockResolvedValue({ id: 'test-limit-order-id' }),
    }
  }
}));

vi.mock('@/src/lib/security/authorization', () => ({
  verifyAndConsumeAuthSignature: vi.fn().mockResolvedValue({ valid: true })
}));

describe('Limit Order API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if validation fails (e.g. missing signature)', async () => {
    const req = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        makerAddress: '0x123',
        tokenIn: '0xabc', 
        tokenOut: '0xdef',
        amountIn: '1000',
        triggerPrice: '2000',
        triggerDirection: 'lte'
      })
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid order');
  });
});
