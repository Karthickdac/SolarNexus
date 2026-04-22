import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "./pages/dashboard";

// Attach an admin bearer token from localStorage when the operator has
// pasted one in via the Alerts settings panel. We deliberately do NOT read
// the secret from a build-time env var because that would bake the secret
// into the JS bundle served to every browser. Read endpoints that don't
// require auth simply ignore the header.
setAuthTokenGetter(() => {
  if (typeof window === "undefined") return null;
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
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
