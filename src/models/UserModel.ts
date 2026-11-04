export interface User {
  id: number;
  name: string;
  email: string;
}

export interface UserPage {
  users: User[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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
    throw new ApiError(response.status, body?.error || `Request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export class UserModel {
  static readPage(query: string, page: number, pageSize: number): Promise<UserPage> {
    const params = new URLSearchParams({
      q: query,
      page: String(page),
      pageSize: String(pageSize)
    });
    return request<UserPage>(`/api/users?${params}`);
  }

  static read(id: number): Promise<User> {
    return request<User>(`/api/users/${id}`);
  }

  static create(name: string, email: string): Promise<User> {
    return request<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, email })
    });
  }

  static update(id: number, name: string, email: string): Promise<void> {
    return request<void>(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, email })
    });
  }

  static delete(id: number): Promise<void> {
    return request<void>(`/api/users/${id}`, { method: 'DELETE' });
  }

  static async exportCsv(query: string): Promise<Blob> {
    const params = new URLSearchParams({ q: query });
    const response = await fetch(`/api/users/export?${params}`, {
      credentials: 'same-origin'
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new ApiError(response.status, body?.error || `Export failed (${response.status})`);
    }
    return response.blob();
  }
}