import { defineConfig } from "vitest/config";

// Cloud Functions runs in UTC. Pinning the tests to it too means a
// timezone bug shows up here rather than being masked by the machine's
// local zone.
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
