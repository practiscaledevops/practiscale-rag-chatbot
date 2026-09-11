import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for the chatbot's pure logic. Dummy env values so modules that read
// env at import time don't throw; the tests exercise pure functions only.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
      BRAIN_API_URL: "http://localhost:3010",
      BRAIN_API_KEY: "psk_test",
    },
  },
});
