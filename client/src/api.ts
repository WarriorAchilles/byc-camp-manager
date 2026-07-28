const apiBase = import.meta.env.VITE_API_URL ?? "";

export function apiUrl(path: string): string {
  return `${apiBase}${path}`;
}

export type ApiHttpError = Error & {
  status: number;
  body: unknown;
};

export async function apiJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    body = JSON.parse(text) as unknown;
  }
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${response.status})`;
    const err = new Error(message) as ApiHttpError;
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

export type AdminRole = "super_admin" | "camp_admin";

export type CurrentUser = {
  id: string;
  username: string;
  role: AdminRole;
  isActive: boolean;
};

export type AdminUserRow = {
  id: string;
  username: string;
  role: AdminRole;
  isActive: boolean;
  createdAt: string;
  createdById: string | null;
};
