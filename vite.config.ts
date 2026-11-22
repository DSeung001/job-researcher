import { defineConfig } from "vite";
export default defineConfig({
  root: "web",
  server: {
    fs: { deny: ["**/.local/**", "**/.git/**", "**/.env*", "**/*.pem"] },
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
