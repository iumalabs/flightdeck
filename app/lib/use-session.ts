import { useEffect, useState } from "react";

export interface Session {
  sub: string;
  email: string;
  role: string;
}

export interface UseSessionResult {
  loading: boolean;
  session: Session | null;
  /** Clears local session recognition and returns to the marketing site. See research.md §3 —
   * this does not attempt to end the underlying Cloudflare Access session. */
  signOut: () => void;
}

export function useSession(): UseSessionResult {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/internal/me", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() as Promise<Session> : null))
      .then((data) => {
        if (!cancelled) setSession(data);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = () => {
    // fd_session is HttpOnly (worker/auth/session.ts), so it can only be cleared server-side —
    // POST /logout overwrites it with an expired cookie (research.md §3 correction: sign-out
    // still needs one server call, just not one that touches the Access session itself). Local
    // state clears only once that round-trip settles, so the UI never claims "signed out" before
    // the cookie is actually gone (a network failure still clears local state — there is nothing
    // more this UI could reasonably do at that point, and staying "signed in" client-side while
    // the cookie may already be gone server-side would be worse).
    fetch("/logout", { method: "POST", credentials: "same-origin" })
      .catch(() => {})
      .finally(() => setSession(null));
  };

  return { loading, session, signOut };
}
