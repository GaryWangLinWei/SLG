export const CONFIG = {
  PORT: parseInt(process.env.AUTH_PORT || '3456'),
  HOST: process.env.AUTH_HOST || '0.0.0.0',
  ADMIN_KEY: process.env.ADMIN_KEY || 'admin-change-me-in-production',
  JWT_SECRET: process.env.JWT_SECRET || 'jwt-secret-change-me-in-production-2025',
  // 密钥轮换过渡期：旧密钥（可为空；为空时仅用 JWT_SECRET 校验）
  JWT_SECRET_LEGACY: process.env.JWT_SECRET_LEGACY || '',
  DB_PATH: process.env.DB_PATH || './auth.db',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};
