import "dotenv/config";
import { db } from "../src/server/db";
import { assertProductionConfig, demoMode } from "../src/server/config";
import { maintenance } from "../src/server/maintenance";
import { validateMaintainedAccounts } from "../src/server/oauth-maintenance";

assertProductionConfig();
demoMode();
let stopping = false;
const wakeups = new Set<() => void>();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
    for (const wake of wakeups) wake();
  });
function wait() {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      wakeups.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, 60_000);
    wakeups.add(finish);
  });
}
async function loop(name: string, action: (first: boolean) => Promise<unknown>) {
  let first = true;
  do {
    const started = Date.now();
    try {
      const counts = await action(first);
      first = false;
      console.log(
        JSON.stringify({ event: `${name}_completed`, durationMs: Date.now() - started, counts }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: `${name}_failed`,
          name: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      if (process.argv.includes("--once")) process.exitCode = 1;
    }
    if (!stopping && !process.argv.includes("--once")) await wait();
  } while (!stopping && !process.argv.includes("--once"));
}
Promise.all([
  loop("maintenance", () => maintenance()),
  loop("oauth_validation", (first) => validateMaintainedAccounts(first)),
])
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
