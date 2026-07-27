/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "biomeindustria.com" },
    ],
  },
};

module.exports = nextConfig;
