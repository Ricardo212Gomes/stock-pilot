import { describe, expect, it } from "vitest";
import { mapLimit, spacing } from "./concurrency";

describe("spacing", () => {
  it("spaces calls out by the interval, however many start at once", async () => {
    let clock = 1_000;
    const waits: number[] = [];
    const space = spacing(150, () => clock, async (ms) => {
      waits.push(ms);
    });
    await Promise.all([space(), space(), space()]);
    expect(waits).toEqual([150, 300]);

    // After a quiet spell, the next call goes straight away.
    clock = 5_000;
    waits.length = 0;
    await space();
    expect(waits).toEqual([]);
  });
});

describe("mapLimit", () => {
  it("keeps the results in order with at most `limit` running", async () => {
    let running = 0;
    let most = 0;
    const results = await mapLimit([30, 10, 20, 5], 2, async (ms) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return ms * 2;
    });
    expect(results).toEqual([60, 20, 40, 10]);
    expect(most).toBe(2);
  });
});
