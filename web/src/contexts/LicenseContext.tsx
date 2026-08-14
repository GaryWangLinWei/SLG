import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { api } from '../api/client';

export interface LicenseStatus {
  activated: boolean;
  expiresAt?: number;
  isExpired: boolean;
  isOffline: boolean;
  graceRemainingMinutes?: number;
  deviceFingerprint?: string;
  tier?: 'basic' | 'pro';
  lastUnboundAt?: number;
  fingerprintMismatch?: boolean;
  storedFingerprint?: string;
  clockRollback?: boolean; // 检测到本地时钟回拨
  trustedNow?: number; // 服务端可信当前时间(ms)，用于显示剩余时间
}

interface LicenseContextType {
  status: LicenseStatus | null;
  loading: boolean;
  error: string | null;
  activateError: string | null;  // 激活错误提示
  expiredMessage: string | null; // 到期跳转时的一次性提示
  setExpiredMessage: (msg: string | null) => void;
  activate: (code: string, inviteCode?: string) => Promise<{ success: boolean; error?: string; inviteBonus?: boolean; inviteError?: string; inviterBonusDays?: number; inviteeBonusDays?: number }>;
  preview: (code: string) => Promise<{ success: boolean; durationDays?: number; tier?: 'basic' | 'pro'; error?: string }>;
  deactivate: () => Promise<void>;
  unbind: () => Promise<{ success: boolean; alreadyUnbound?: boolean; activationCode?: string }>;
  refreshStatus: () => Promise<void>;
  syncStatus: () => Promise<void>;   // 手动心跳同步
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

  const activate = useCallback(async (code: string, inviteCode?: string): Promise<{ success: boolean; error?: string; inviteBonus?: boolean; inviteError?: string; inviterBonusDays?: number; inviteeBonusDays?: number }> => {
    try {
      setLoading(true);
      setActivateError(null);  // 清除之前的错误
      const result = await api.license.activate(code, inviteCode);
      if (result.success) {
        await refreshStatus();
        return {
          success: true,
          inviteBonus: result.inviteBonus,
          inviteError: result.inviteError,
          inviterBonusDays: result.inviterBonusDays,
          inviteeBonusDays: result.inviteeBonusDays,
        };
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

  const syncStatus = useCallback(async () => {
    try {
      await api.license.heartbeat();
      await refreshStatus();
    } catch { /* ignore */ }
  }, [refreshStatus]);

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

  const unbind = useCallback(async () => {
    setLoading(true);
    try {
      // 非 2xx 会抛 ApiError，错误体在 e.data，由 UI 弹窗读取。
      // 成功后不立即 refreshStatus：UI 要先展示卡密让用户记下，确认后再跳转激活页。
      return await api.license.unbind();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    // 每10分钟刷新一次状态
    const interval = setInterval(refreshStatus, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // 时钟异常自愈：用户可能之前改了系统时间导致锚点被污染，调回正常时间后
  // 自动发起一次心跳，服务端确认有效即重写锚点解除异常。只在检测到异常时尝试一次。
  const clockRollback = status?.clockRollback;
  const recoveredRef = useRef(false);
  useEffect(() => {
    if (clockRollback && !recoveredRef.current) {
      recoveredRef.current = true;
      syncStatus();
    }
    if (!clockRollback) {
      recoveredRef.current = false;
    }
  }, [clockRollback, syncStatus]);

  return (
    <LicenseContext.Provider value={{ status, loading, error, activateError, expiredMessage, setExpiredMessage, activate, preview, deactivate, unbind, refreshStatus, syncStatus, clearActivateError }}>
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
