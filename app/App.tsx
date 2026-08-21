import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useSession } from "./lib/use-session.ts";
import { MarketingNav } from "./components/MarketingNav.tsx";
import { Footer } from "./components/Footer.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { ProductPage } from "./pages/ProductPage.tsx";
import { DocsPage } from "./pages/DocsPage.tsx";
import { SelfHostingPage } from "./pages/SelfHostingPage.tsx";
import { ChangelogPage } from "./pages/ChangelogPage.tsx";

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
  const { loading, session } = useSession();
  const [signInOpen, setSignInOpen] = useState(false);

  if (loading) {
    return null;
  }

  if (session) {
    // Wired in by User Story 2/3 — the authenticated app-shell branch.
    return <div>Loading FlightDeck…</div>;
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
      {/* SignInModal wired in by User Story 2 */}
      {signInOpen && null}
    </div>
  );
}
