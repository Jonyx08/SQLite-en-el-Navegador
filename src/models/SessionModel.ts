export interface Account {
  id: number;
  name: string;
  email: string;
}

export interface SessionState {
  authenticated: boolean;
  account?: Account;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.method && options.method !== 'GET' ? { 'X-Requested-With': 'XMLHttpRequest' } : {}),
      ...options?.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export class SessionModel {
  static current(): Promise<SessionState> {
    return request<SessionState>('/api/auth/session');
  }

  static login(email: string, password: string): Promise<Account> {
    return request<Account>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  }

  static register(name: string, email: string, password: string): Promise<Account> {
    return request<Account>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password })
    });
  }

  static logout(): Promise<void> {
    return request<void>('/api/auth/logout', { method: 'POST' });
  }
}
