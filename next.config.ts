import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  // Enable turbopack to silence the build warning
  turbopack: {},
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.prod.website-files.com',
      },
      {
        protocol: 'https',
        hostname: '*.webflow.io',
      },
      {
        protocol: 'https',
        hostname: 'webflow.com',
      },
      {
        protocol: 'https',
        hostname: 'templates.luminardigital.com',
      },
    ],
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = config.resolve.alias ?? {};
    config.resolve.alias["@aws-sdk/client-s3"] = path.resolve(
      __dirname,
      "stubs/aws-sdk-client-s3.js"
    );
    return config;
  },
};

export default nextConfig;
