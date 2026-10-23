import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // The reconstruction pipeline (multi-view fit + shape transfer) does real
    // numerical work. The default 5 s is too tight when several workers
    // compete for the same CPU.
    testTimeout: 30000,
    hookTimeout: 30000,
    // The geometry tests build a ~25k vertex head and run a dense
    // correspondence search. On a small machine the default worker count
    // starves them, so the pool is capped to keep the suite reliable.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
