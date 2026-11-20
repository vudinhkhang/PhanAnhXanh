import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ["leaflet", "leaflet.markercluster", "react-markdown"] },
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/maplibre-gl")) return "maplibre";
          if (id.includes("node_modules/leaflet")) return "leaflet";
        },
      },
    },
  },
  server: {
    watch: {
      ignored: [
        "**/.runtime/**",
        "**/.venv/**",
        "**/test-results/**",
        "**/backend/**",
      ],
    },
    fs: {
      deny: [
        ".env",
        ".env.*",
        "**/.runtime/**",
        "**/.git/**",
        "**/.venv/**",
        "**/*.{crt,pem}",
      ],
    },
    proxy: { "/api": "http://127.0.0.1:8010" },
  },
});
