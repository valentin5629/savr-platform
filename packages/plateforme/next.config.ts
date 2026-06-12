import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@savr/shared'],
  experimental: {
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    },
  },
};

export default config;
