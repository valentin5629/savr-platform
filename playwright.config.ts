import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @savr/plateforme dev',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321',
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key',
          SUPABASE_SERVICE_ROLE_KEY:
            process.env.SUPABASE_SERVICE_ROLE_KEY ??
            'placeholder-service-role-key',
        },
      },
  projects: [
    {
      name: 'api',
      use: {},
    },
  ],
});
