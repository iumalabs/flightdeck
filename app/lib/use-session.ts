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

// Stub for Phase 2 (Foundational) — App.tsx compiles against this shape ahead of the real
// implementation, which lands in User Story 2 (worker/auth + GET /api/internal/me wiring).
export function useSession(): UseSessionResult {
  return { loading: false, session: null, signOut: () => {} };
}
