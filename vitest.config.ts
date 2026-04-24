import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Minimal Vitest config — pure Node unit tests only.
 *
 * Issue #21 extends this with `jsdom`, `@testing-library/react`, and
 * `setupFiles` for component tests. This slice ships just enough to cover
 * the pure parser in `lib/commodus/parser.test.ts` without pulling in a
 * DOM or React test harness we don't need yet.
 *
 * The `@/*` alias mirrors `tsconfig.json` so test imports match runtime
 * imports exactly.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
