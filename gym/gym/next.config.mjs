/** @type {import('next').NextConfig} */

import path from "path";

const __dirname = import.meta.dirname;

const nextConfig = {
  webpack: (config) => {
    config.resolve.alias["@"] = path.resolve(__dirname, "app");
    return config;
  },
};

export default nextConfig;
