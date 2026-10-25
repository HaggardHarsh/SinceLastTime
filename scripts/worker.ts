import "dotenv/config";
import { db } from "../src/server/db";
import { assertProductionConfig, demoMode } from "../src/server/config";
import { maintenance } from "../src/server/maintenance";

assertProductionConfig();
demoMode();
let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });

async function run() {
  let first = true;
  do {
    try {
      await maintenance(new Date(), first);
      first = false;
      console.log(JSON.stringify({ event: "maintenance_completed" }));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "maintenance_failed",
          name: error instanceof Error ? error.name : "UnknownError",
        }),
      );
    }
    if (!stopping && !process.argv.includes("--once"))
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 60_000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
  } while (!stopping && !process.argv.includes("--once"));
}
run().finally(() => db.$disconnect());
