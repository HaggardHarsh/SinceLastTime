import { expect, it } from "vitest";
import { mapConcurrent } from "../../src/server/concurrency";
it("bounds external work and processes each item once", async () => {
  let running = 0,
    maximum = 0;
  const completed = new Set<number>();
  await mapConcurrent(
    Array.from({ length: 31 }, (_, index) => index),
    5,
    async (index) => {
      running++;
      maximum = Math.max(maximum, running);
      await Promise.resolve();
      completed.add(index);
      running--;
    },
  );
  expect(maximum).toBe(5);
  expect(completed.size).toBe(31);
});
