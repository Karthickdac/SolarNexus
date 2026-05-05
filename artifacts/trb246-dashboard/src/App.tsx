import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "./pages/dashboard";
import LoginPage from "./pages/login";
import ForgotPasswordPage from "./pages/forgot-password";
import ResetPasswordPage from "./pages/reset-password";
import AcceptInvitePage from "./pages/accept-invite";
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

function ProtectedDashboard() {
  const authed = useIsAuthenticated();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (!authed) navigate("/login", { replace: true });
  }, [authed, navigate]);
  if (!authed) return null;
  return <Dashboard />;
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
      <Route path="/settings" component={ProtectedDashboard} />
      <Route path="/settings/:tab" component={ProtectedDashboard} />
      <Route path="/" component={ProtectedDashboard} />
      <Route path="/overview" component={ProtectedDashboard} />
      <Route path="/simulation" component={ProtectedDashboard} />
      <Route path="/analytics" component={ProtectedDashboard} />
      <Route path="/report" component={ProtectedDashboard} />
      <Route path="/alerts" component={ProtectedDashboard} />
      <Route path="/config" component={ProtectedDashboard} />
      <Route path="/sites" component={ProtectedDashboard} />
      <Route path="/users" component={ProtectedDashboard} />
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
