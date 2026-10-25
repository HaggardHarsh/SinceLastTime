import "dotenv/config";
import { assertProductionConfig } from "../src/server/config";

try {
  assertProductionConfig(true);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid application configuration.");
  process.exit(1);
}
