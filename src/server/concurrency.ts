export async function mapConcurrent<T>(
  items: T[],
  limit: number,
  action: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await action(item);
      }
    }),
  );
}
