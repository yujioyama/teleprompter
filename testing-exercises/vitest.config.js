import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
      // Use happy-dom to avoid jsdom/parse5 ESM-CJS issues and keep DOM APIs
      environment: "happy-dom",
  },
});
