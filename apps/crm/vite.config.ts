import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    // The API's credentialed CORS allowlist trusts this exact origin
    // (config/env.ts CRM_APP_URL = http://localhost:3002). If 3002 is taken,
    // Vite would silently drift to 3003 and every /api call gets CORS-blocked
    // ("No 'Access-Control-Allow-Origin'"). Fail loudly instead so the port
    // stays in lockstep with the allowlist.
    strictPort: true,
  },
  preview: {
    port: 3002,
    strictPort: true,
  },
});
