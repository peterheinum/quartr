import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API runs separately; proxying keeps the client on one origin so
    // there is no CORS handling or absolute URL in the frontend code.
    proxy: { "/api": { target: "http://localhost:3001", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
