import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    // The admin console reads trace and conversation data from the harness server, which owns
    // the session cookie; proxying keeps both on one origin so the browser sends it.
    proxy: { "/api": "http://localhost:3000" },
  },
});
