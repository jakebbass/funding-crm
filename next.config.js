/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: 'standalone',
  experimental: {
    outputFileTracingRoot: process.cwd(),
  },
  env: {
    GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
    GOOGLE_SERVICE_EMAIL: process.env.GOOGLE_SERVICE_EMAIL,
    GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    FIREFLIES_API_KEY: process.env.FIREFLIES_API_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
  },
}

module.exports = nextConfig
