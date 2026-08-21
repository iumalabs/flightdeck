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
    // state clears immediately rather than waiting on the network round-trip, since there's
    // nothing meaningful to show mid-flight and the cookie clear can't fail in a way the UI
    // would need to react to.
    setSession(null);
    fetch("/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  };

  return { loading, session, signOut };
}
