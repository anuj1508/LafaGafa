import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5175,
    // The chat app posts messages and reads the SSE reply stream from the harness server.
    proxy: { "/api": "http://localhost:3000" },
  },
});
