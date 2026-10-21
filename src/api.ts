import type { Session } from "../shared/schema.js";

let csrfToken = "";
export function setSessionToken(session: Session) {
  csrfToken = session.csrfToken;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" ? { "X-CSRF-Token": csrfToken } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      "Unable to reach the server. Check your connection and try again; no change has been confirmed.",
    );
  }
  const result = await response
    .json()
    .catch(() => ({ error: "The server returned an unexpected response." }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(result.error ?? "Request failed.", response.status);
  }
  return result;
}
