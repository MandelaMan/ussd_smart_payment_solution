import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/admin/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      devOptions: {
        enabled: false,
      },
      includeAssets: ["favicon.svg", "logo.png", "icons.svg"],
      manifest: {
        name: "SUL Bix",
        short_name: "SUL Bix",
        description: "A unified hub for customer management and billing",
        start_url: "/admin/",
        scope: "/admin/",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#166a82",
        theme_color: "#166a82",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/admin/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api"),
            handler: "NetworkOnly",
          },
          {
            // Prefer network for shell assets so nav CSS cannot stick on an old build.
            urlPattern: ({ request }) =>
              request.destination === "document" ||
              request.destination === "script" ||
              request.destination === "style",
            handler: "NetworkFirst",
            options: {
              cacheName: "admin-shell-v2",
              networkTimeoutSeconds: 4,
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        timeout: 15000,
        proxyTimeout: 15000,
      },
      "/leads": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2020",
    cssCodeSplit: true,
    // ECharts/Chakra vendor chunks routinely exceed Vite's 500 kB default.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("echarts")) return "echarts";
          if (id.includes("recharts") || id.includes("d3-")) return "recharts";
          if (id.includes("@chakra-ui") || id.includes("@emotion")) return "chakra";
          if (id.includes("socket.io")) return "socket";
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("react-dom") || id.includes("/react/")) return "react";
        },
      },
    },
  },
});
