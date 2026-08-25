import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useSession } from "./lib/use-session.ts";
import { MarketingNav } from "./components/MarketingNav.tsx";
import { Footer } from "./components/Footer.tsx";
import { SignInModal } from "./components/SignInModal.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { ProductPage } from "./pages/ProductPage.tsx";
import { DocsPage } from "./pages/DocsPage.tsx";
import { SelfHostingPage } from "./pages/SelfHostingPage.tsx";
import { ChangelogPage } from "./pages/ChangelogPage.tsx";
import { AppShell } from "./shell/AppShell.tsx";

// Hand-rolled router (research.md §4): a pathname → screen lookup table, driven by real
// history.pushState/popstate so deep links and browser back/forward work. Not a router library —
// see research.md §4 for why.
function usePathname(): [string, (path: string) => void] {
  const [pathname, setPathname] = useState(() => globalThis.location.pathname);

  useEffect(() => {
    const onPopState = () => setPathname(globalThis.location.pathname);
    globalThis.addEventListener("popstate", onPopState);
    return () => globalThis.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (path: string) => {
    if (path === globalThis.location.pathname) return;
    globalThis.history.pushState(null, "", path);
    setPathname(path);
    globalThis.scrollTo(0, 0);
  };

  return [pathname, navigate];
}

// The app shell mounts at "/" (a returning authenticated user lands there per spec US2 AC4) and
// under this prefix — everything else is a marketing pathname, authenticated or not (issues #57,
// #58).
const APP_SHELL_PATH_PREFIX = "/web-app";

function isAppShellPath(pathname: string): boolean {
  return pathname === "/" || pathname === APP_SHELL_PATH_PREFIX ||
    pathname.startsWith(`${APP_SHELL_PATH_PREFIX}/`);
}

function renderMarketingPage(
  pathname: string,
  navigate: (path: string) => void,
  onCtaClick: () => void,
  loggedIn: boolean,
): ReactElement {
  switch (pathname) {
    case "/product":
      return <ProductPage />;
    case "/docs":
      return <DocsPage />;
    case "/self-hosting":
      return <SelfHostingPage />;
    case "/changelog":
      return <ChangelogPage />;
    default:
      return <HomePage onLoginClick={onCtaClick} navigate={navigate} loggedIn={loggedIn} />;
  }
}

export function App() {
  const [pathname, navigate] = usePathname();
  const { loading, session, signOut } = useSession();
  // Unauthenticated-redirect guard (spec Edge Cases): a direct visit to an app-shell URL with no
  // session opens the sign-in flow immediately, rather than silently falling through to Home as
  // if the visitor had just wandered onto the marketing site.
  const [signInOpen, setSignInOpen] = useState(() => pathname.startsWith(APP_SHELL_PATH_PREFIX));

  if (loading) {
    return null;
  }

  // A session is authoritative at the app-shell paths regardless of which of those paths it is —
  // a returning user with a still-valid fd_session lands in the app shell at "/" or "/web-app/*"
  // (spec US2 AC4) without re-authenticating. It is NOT authoritative for marketing pathnames like
  // /docs or /changelog (issue #57) — those stay reachable, session or not.
  if (session && isAppShellPath(pathname)) {
    return (
      <AppShell
        session={session}
        signOut={() => {
          signOut();
          navigate("/");
        }}
        navigate={navigate}
        pathname={pathname}
      />
    );
  }

  const loggedIn = Boolean(session);
  // For an authenticated session viewing a marketing page, the nav/hero CTA (already wired to
  // toggle its label to "Open app →" / "Open the deck" when loggedIn) goes back into the app
  // shell instead of opening the sign-in modal — issue #57's "way back in" without forcing a
  // sign-out.
  const onCtaClick = loggedIn ? () => navigate(APP_SHELL_PATH_PREFIX) : () => setSignInOpen(true);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--fg)",
        backgroundImage:
          "linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px)",
        backgroundSize: "56px 56px",
      }}
    >
      <MarketingNav
        pathname={pathname}
        navigate={navigate}
        loggedIn={loggedIn}
        sessionHint=""
        onLoginClick={onCtaClick}
      />
      {renderMarketingPage(pathname, navigate, onCtaClick, loggedIn)}
      <Footer navigate={navigate} />
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
