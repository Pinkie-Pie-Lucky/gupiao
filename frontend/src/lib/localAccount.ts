export interface LocalAccount {
  phone: string;
  nickname: string;
}

const ACCOUNT_KEY = 'bubble-local-account-v1';
const SESSION_KEY = 'bubble-local-session-v1';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
}

export function getStoredAccount(): LocalAccount | null {
  try {
    const value = JSON.parse(readStorage(ACCOUNT_KEY) || 'null');
    if (typeof value?.phone !== 'string' || typeof value?.nickname !== 'string') return null;
    return { phone: value.phone, nickname: value.nickname };
  } catch {
    return null;
  }
}

export function getActiveAccount(): LocalAccount | null {
  const account = getStoredAccount();
  return account && readStorage(SESSION_KEY) === account.phone ? account : null;
}

export function registerLocalAccount(account: LocalAccount): LocalAccount {
  writeStorage(ACCOUNT_KEY, JSON.stringify(account));
  writeStorage(SESSION_KEY, account.phone);
  return account;
}

export function signInLocalAccount(phone: string): LocalAccount | null {
  const account = getStoredAccount();
  if (!account || account.phone !== phone) return null;
  writeStorage(SESSION_KEY, phone);
  return account;
}

export function updateLocalNickname(nickname: string): LocalAccount | null {
  const account = getActiveAccount();
  if (!account) return null;
  const updated = { ...account, nickname };
  writeStorage(ACCOUNT_KEY, JSON.stringify(updated));
  return updated;
}

export function signOutLocalAccount(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // The in-memory UI state will still return to the sign-in screen.
  }
}
