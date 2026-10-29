import type { Session } from "../shared/schema.js";

let csrfToken = "";
export function setSessionToken(session: Session) {
  csrfToken = session.csrfToken;
}
// The anonymous session expires while an idle sign-in form remains open.
// Bootstrap immediately before authentication; never replay credential writes.
export async function authenticate(
  mode: "login" | "register",
  credentials: { email: string; password: string },
): Promise<Session> {
  const session = await api<Session>("/session");
  setSessionToken(session);
  if (session.user) return session;
  return api<Session>(`/auth/${mode}`, "POST", credentials);
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
  if (response.status === 401 && !path.startsWith("/auth/"))
    window.dispatchEvent(new Event("session-expired"));
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      "The server returned an unexpected response. Try loading again; no change has been confirmed.",
      response.status,
    );
  }
  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Request failed.";
    throw new ApiError(message, response.status);
  }
  return result as T;
}
