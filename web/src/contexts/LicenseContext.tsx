import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api } from '../api/client';

export interface LicenseStatus {
  activated: boolean;
  expiresAt?: number;
  isExpired: boolean;
  isOffline: boolean;
  graceRemainingMinutes?: number;
  deviceFingerprint?: string;
}

interface LicenseContextType {
  status: LicenseStatus | null;
  loading: boolean;
  error: string | null;
  activateError: string | null;  // 激活错误提示
  expiredMessage: string | null; // 到期跳转时的一次性提示
  setExpiredMessage: (msg: string | null) => void;
  activate: (code: string) => Promise<{ success: boolean; error?: string }>;
  preview: (code: string) => Promise<{ success: boolean; durationDays?: number; error?: string }>;
  deactivate: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  clearActivateError: () => void;  // 清除激活错误
}

const LicenseContext = createContext<LicenseContextType | null>(null);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [expiredMessage, setExpiredMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await api.license.getStatus();
      if (response.success) {
        setStatus(response.status);
        setError(null);
      }
    } catch (e: any) {
      console.error('获取许可证状态失败:', e);
      setError(e.message || '获取状态失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const activate = useCallback(async (code: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setLoading(true);
      setActivateError(null);  // 清除之前的错误
      const result = await api.license.activate(code);
      if (result.success) {
        await refreshStatus();
        return { success: true };
      }
      const errorMsg = result.error || '激活失败，请检查激活码';
      setActivateError(errorMsg);
      return { success: false, error: errorMsg };
    } catch (e: any) {
      // ApiError 已经包含处理好的错误信息
      const errorMsg = e.data?.error || e.data?.message || e.message || '激活失败，请检查激活码';
      setActivateError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setLoading(false);
    }
  }, [refreshStatus]);

  const clearActivateError = useCallback(() => {
    setActivateError(null);
  }, []);

  const preview = useCallback(async (code: string) => {
    try {
      return await api.license.preview(code);
    } catch (e: any) {
      return { success: false, error: e.message || '无法预览激活码' };
    }
  }, []);

  const deactivate = useCallback(async () => {
    try {
      setLoading(true);
      await api.license.deactivate();
      await refreshStatus();
    } catch (e: any) {
      setError(e.message || '取消激活失败');
    } finally {
      setLoading(false);
    }
  }, [refreshStatus]);

  useEffect(() => {
    refreshStatus();
    // 每10分钟刷新一次状态
    const interval = setInterval(refreshStatus, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  return (
    <LicenseContext.Provider value={{ status, loading, error, activateError, expiredMessage, setExpiredMessage, activate, preview, deactivate, refreshStatus, clearActivateError }}>
      {children}
    </LicenseContext.Provider>
  );
}

export function useLicense() {
  const context = useContext(LicenseContext);
  if (!context) {
    throw new Error('useLicense must be used within a LicenseProvider');
  }
  return context;
}
