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

function renderMarketingPage(
  pathname: string,
  navigate: (path: string) => void,
  onLoginClick: () => void,
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
      return <HomePage onLoginClick={onLoginClick} navigate={navigate} loggedIn={loggedIn} />;
  }
}

export function App() {
  const [pathname, navigate] = usePathname();
  const { loading, session, signOut } = useSession();
  // Unauthenticated-redirect guard (spec Edge Cases): a direct visit to an app-shell URL with no
  // session opens the sign-in flow immediately, rather than silently falling through to Home as
  // if the visitor had just wandered onto the marketing site.
  const [signInOpen, setSignInOpen] = useState(() => pathname.startsWith("/web-app"));

  if (loading) {
    return null;
  }

  // A session is authoritative regardless of pathname — a returning user with a still-valid
  // fd_session lands in the app shell even at "/" (spec US2 AC4), not only at /web-app/*.
  if (session) {
    return (
      <AppShell
        session={session}
        signOut={() => {
          signOut();
          navigate("/");
        }}
        navigate={navigate}
      />
    );
  }

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
        loggedIn={false}
        sessionHint=""
        onLoginClick={() => setSignInOpen(true)}
      />
      {renderMarketingPage(pathname, navigate, () => setSignInOpen(true), false)}
      <Footer navigate={navigate} />
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}
