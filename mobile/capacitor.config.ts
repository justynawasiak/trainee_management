import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "pl.klub.app",
  appName: "Klub",
  webDir: "www",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https"
  }
};

export default config;

