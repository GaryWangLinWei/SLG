import { defineConfig, type ConfigEnv, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

export function createViteConfig(
  command: ConfigEnv['command'],
  edition: string | undefined = process.env.VITE_APP_EDITION
): UserConfig {
  if (command === 'build' && edition !== 'main' && edition !== 'agent') {
    throw new Error('VITE_APP_EDITION must be set to "main" or "agent" for production builds');
  }

  return {
    plugins: [react()],
    base: './',
    ...(command === 'serve' ? {
      define: {
        'import.meta.env.VITE_APP_EDITION': JSON.stringify('main'),
      },
    } : {}),
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true
        }
      }
    }
  };
}

export default defineConfig(({ command }) => createViteConfig(command));
