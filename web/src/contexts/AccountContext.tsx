import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { api, Account } from '../api/client';

interface AccountContextValue {
  accounts: Account[];
  currentAccountId: string | null;
  setCurrentAccountId: (id: string | null) => void;
  refreshAccounts: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  currentAccountId: null,
  setCurrentAccountId: () => {},
  refreshAccounts: async () => {}
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccountId, setCurrentAccountIdState] = useState<string | null>(() => {
    return localStorage.getItem('currentAccountId');
  });
  const currentRef = useRef(currentAccountId);
  currentRef.current = currentAccountId;

  const setCurrentAccountId = useCallback((id: string | null) => {
    setCurrentAccountIdState(id);
    currentRef.current = id;
    if (id) {
      localStorage.setItem('currentAccountId', id);
    } else {
      localStorage.removeItem('currentAccountId');
    }
  }, []);

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await api.accounts.list();
      setAccounts(res.accounts);
      // 如果没有选中账号但列表非空，自动选第一个
      if (!currentRef.current && res.accounts.length > 0) {
        const first = res.accounts[0].id;
        setCurrentAccountIdState(first);
        currentRef.current = first;
        localStorage.setItem('currentAccountId', first);
      }
    } catch { /* will retry on next mount */ }
  }, []);

  // On mount: load accounts, then validate currentAccountId
  useEffect(() => {
    (async () => {
      try {
        const res = await api.accounts.list();
        const list = res.accounts;
        setAccounts(list);

        const stored = localStorage.getItem('currentAccountId');
        if (stored && list.some(a => a.id === stored)) {
          setCurrentAccountIdState(stored);
        } else if (list.length > 0) {
          const first = list[0].id;
          setCurrentAccountIdState(first);
          localStorage.setItem('currentAccountId', first);
        } else {
          // No accounts — clear stale localStorage so guard UI shows
          setCurrentAccountIdState(null);
          localStorage.removeItem('currentAccountId');
        }
      } catch {
        // API unreachable — clear stale currentAccountId so guard UI shows
        setAccounts([]);
        setCurrentAccountIdState(null);
        localStorage.removeItem('currentAccountId');
      }
    })();
  }, []);


  return (
    <AccountContext.Provider value={{ accounts, currentAccountId, setCurrentAccountId, refreshAccounts }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}
