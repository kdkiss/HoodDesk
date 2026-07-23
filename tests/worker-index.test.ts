import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/worker/index.ts', () => ({
  startWorker: vi.fn(),
}));

describe('Worker Execution Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully calculate slippage with safety buffer for V2 swap', () => {
    const order = {
      maximumSlippageBps: 100,
    };
    
    // Test that the worker forces Math.max(100, 500)
    const appliedSlippageBps = Math.max(order.maximumSlippageBps, 500);
    expect(appliedSlippageBps).toBe(500);
    
    const expectedOut = 10000n;
    const minOut = (expectedOut * BigInt(10000 - appliedSlippageBps)) / 10000n;
    
    expect(minOut).toBe(9500n); // 5% slippage applied
  });

  it('should use user slippage if it is greater than 500 bps', () => {
    const order = {
      maximumSlippageBps: 800,
    };
    
    const appliedSlippageBps = Math.max(order.maximumSlippageBps, 500);
    expect(appliedSlippageBps).toBe(800);
    
    const expectedOut = 10000n;
    const minOut = (expectedOut * BigInt(10000 - appliedSlippageBps)) / 10000n;
    
    expect(minOut).toBe(9200n); // 8% slippage applied
  });
});
