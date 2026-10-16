import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium", "@stafyniaksacha/facturx", "libxml2-wasm", "saxon-js"],
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./lib/facturx-assets/**",
      "./node_modules/@stafyniaksacha/facturx/dist/**",
      "./node_modules/libxml2-wasm/**",
      "./node_modules/saxon-js/**",
    ],
    "/api/stripe/webhook": [
      "./node_modules/playwright-core/**",
      "./node_modules/@sparticuz/chromium/**",
    ],
  },
};

export default nextConfig;
