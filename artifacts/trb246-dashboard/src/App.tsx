import { useEffect, useState, type ComponentType } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app-shell";
import NotFound from "@/pages/not-found";
import OverviewPage from "@/pages/overview";
import AnalyticsPage from "@/pages/analytics";
import ReadingsPage from "@/pages/readings";
import AlertsPage from "@/pages/alerts";
import OrgSettingsPage from "@/pages/org-settings";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import AcceptInvitePage from "@/pages/accept-invite";
import { getStoredToken } from "@/lib/auth";

// Attach the active session token (preferred) or the legacy admin token
// pasted into the Alerts settings panel as a fallback. Read endpoints
// that don't require auth simply ignore the header.
setAuthTokenGetter(() => {
  if (typeof window === "undefined") return null;
  const session = getStoredToken();
  if (session) return session;
  try {
    return window.localStorage.getItem("solarnexus.adminApiToken");
  } catch {
    return null;
  }
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

function useIsAuthenticated(): boolean {
  const [authed, setAuthed] = useState<boolean>(() => !!getStoredToken());
  useEffect(() => {
    const sync = () => setAuthed(!!getStoredToken());
    window.addEventListener("storage", sync);
    window.addEventListener("solarnexus:auth-changed", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("solarnexus:auth-changed", sync);
    };
  }, []);
  return authed;
}

function Protected({ component: Component }: { component: ComponentType }) {
  const authed = useIsAuthenticated();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (!authed) navigate("/login", { replace: true });
  }, [authed, navigate]);
  if (!authed) return null;
  return (
    <AppShell>
      <Component />
    </AppShell>
  );
}

function LoginRoute() {
  const authed = useIsAuthenticated();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (authed) navigate("/", { replace: true });
  }, [authed, navigate]);
  if (authed) return null;
  return <LoginPage />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginRoute} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/accept-invite" component={AcceptInvitePage} />
      <Route path="/">{() => <Protected component={OverviewPage} />}</Route>
      <Route path="/analytics">{() => <Protected component={AnalyticsPage} />}</Route>
      <Route path="/readings">{() => <Protected component={ReadingsPage} />}</Route>
      <Route path="/alerts">{() => <Protected component={AlertsPage} />}</Route>
      <Route path="/settings">{() => <Protected component={OrgSettingsPage} />}</Route>
      <Route path="/settings/:tab">{() => <Protected component={OrgSettingsPage} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
