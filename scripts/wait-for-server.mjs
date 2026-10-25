const origin = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  try {
    if ((await fetch(`${origin}/api/health`)).ok) process.exit(0);
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.error("Application server did not become ready.");
process.exit(1);
