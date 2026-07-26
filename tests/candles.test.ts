import { describe, expect, it } from "vitest";
import {
  bucketIntoCandles,
  scaleCandles,
} from "@/src/lib/chart/candles";

describe("chart candles", () => {
  it("builds real OHLCV values from observed trades", () => {
    const candles = bucketIntoCandles([
      { timestamp: 101, price: 2, volumeEth: 1 },
      { timestamp: 110, price: 4, volumeEth: 2 },
      { timestamp: 119, price: 3, volumeEth: 3 },
    ], 60);

    expect(candles).toEqual([{
      time: 60,
      open: 2,
      high: 4,
      low: 2,
      close: 3,
      volume: 6,
      observed: true,
    }]);
  });

  it("leaves empty time buckets absent instead of inventing flat candles", () => {
    const candles = bucketIntoCandles(
      [
        { timestamp: 65, price: 1, volumeEth: 1 },
        { timestamp: 185, price: 2, volumeEth: 1 },
      ],
      60
    );

    expect(candles.map((candle) => candle.time)).toEqual([60, 180]);
  });

  it("scales OHLC values without changing source volume or provenance", () => {
    const scaled = scaleCandles([{
      time: 60,
      open: 2,
      high: 4,
      low: 1,
      close: 3,
      volume: 5,
      observed: true,
    }], 10);

    expect(scaled[0]).toEqual({
      time: 60,
      open: 20,
      high: 40,
      low: 10,
      close: 30,
      volume: 5,
      observed: true,
    });
  });
});
