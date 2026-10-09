export class ApiError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

let refreshOnce: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshOnce ??= fetch("/backend/auth/refresh", { method: "POST", credentials: "include" })
    .then((response) => response.ok)
    .finally(() => {
      refreshOnce = null;
    });
  return refreshOnce;
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const response = await fetch(`/backend${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401 && retry && !path.startsWith("/auth/")) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, init, false);
  }
  const json = (await response.json().catch(() => null)) as { success?: boolean; data?: T; error?: { message?: string } } | null;
  if (!response.ok || json?.success === false) {
    throw new ApiError(json?.error?.message ?? "Request failed", response.status);
  }
  return json?.data as T;
}

export async function runtimeRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`/backend${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}
