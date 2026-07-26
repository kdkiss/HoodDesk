export interface PricePoint {
  timestamp: number;
  price: number;
  volumeEth: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  observed: boolean;
}

export function bucketIntoCandles(
  points: PricePoint[],
  bucketSeconds: number
): Candle[] {
  const buckets = new Map<number, Candle>();

  for (const point of points) {
    const bucketStart =
      Math.floor(point.timestamp / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        time: bucketStart,
        open: point.price,
        high: point.price,
        low: point.price,
        close: point.price,
        volume: point.volumeEth,
        observed: true,
      });
      continue;
    }

    existing.high = Math.max(existing.high, point.price);
    existing.low = Math.min(existing.low, point.price);
    existing.close = point.price;
    existing.volume += point.volumeEth;
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

export function scaleCandles(
  candles: Candle[],
  multiplier: number
): Candle[] {
  return candles.map((candle) => ({
    ...candle,
    open: candle.open * multiplier,
    high: candle.high * multiplier,
    low: candle.low * multiplier,
    close: candle.close * multiplier,
  }));
}
