import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const API_ORIGIN = "http://127.0.0.1:4000";

/** Nodemon restarts drop the API briefly; retry instead of returning 502. */
function apiProxy(extra: ProxyOptions = {}): ProxyOptions {
  return {
    target: API_ORIGIN,
    changeOrigin: true,
    ...extra,
    configure(proxy) {
      extra.configure?.(proxy, extra);
      const originalWeb = proxy.web.bind(proxy);
      proxy.web = ((req, res, options, callback) => {
        const tryOnce = (attempt: number) => {
          originalWeb(req, res, options, (error) => {
            const code = (error as NodeJS.ErrnoException | undefined)?.code;
            const canRetry =
              Boolean(error) &&
              (code === "ECONNREFUSED" || code === "ECONNRESET") &&
              attempt < 8 &&
              Boolean(res) &&
              "headersSent" in res &&
              !res.headersSent;
            if (canRetry) {
              setTimeout(
                () => tryOnce(attempt + 1),
                Math.min(150 * 2 ** attempt, 1500)
              );
              return;
            }
            callback?.(error);
          });
        };
        tryOnce(0);
      }) as typeof proxy.web;
    },
  };
}

export default defineConfig({
  base: "/admin/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      devOptions: {
        enabled: false,
      },
      includeAssets: ["favicon.svg", "logo.png", "icons.svg", "sw-push.js"],
      manifest: {
        name: "SUL Bix",
        short_name: "SUL Bix",
        description: "A unified hub for customer service management and billing",
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
        importScripts: ["sw-push.js"],
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
              cacheName: "admin-shell-v5",
              networkTimeoutSeconds: 4,
            },
          },
        ],
      },
    }),
  ],
  server: {
    // Keep in sync with ADMIN_ORIGIN — cookies set on localhost are not sent to 127.0.0.1.
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": apiProxy({
        ws: true,
        timeout: 60000,
        proxyTimeout: 60000,
      }),
      "/leads": apiProxy(),
      "/signup": apiProxy(),
    },
  },
  optimizeDeps: {
    include: [
      "recharts",
      "echarts",
      "socket.io-client",
      "@chakra-ui/react",
      "framer-motion",
    ],
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
