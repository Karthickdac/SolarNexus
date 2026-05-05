import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun, Loader2 } from "lucide-react";

type InviteSummary = {
  orgName: string;
  email: string;
  role: string;
  expiresAt: string;
};

export default function AcceptInvitePage() {
  const [, navigate] = useLocation();
  const [token, setToken] = useState("");
  const [summary, setSummary] = useState<InviteSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token") ?? "";
    setToken(t);
    if (!t) {
      setLoading(false);
      setLoadError("Missing invitation token.");
      return;
    }
    fetch(`${base}/api/invitations/${encodeURIComponent(t)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Invitation not found.");
        }
        return r.json();
      })
      .then((data) => setSummary(data as InviteSummary))
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Error"))
      .finally(() => setLoading(false));
  }, [base]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `${base}/api/invitations/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), password }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to accept invitation.");
      }
      // Redirect to login so they can sign in with their new password.
      navigate("/login", { replace: true });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to accept invitation.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-amber-50 px-4 py-12 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-lg shadow-amber-500/30">
            <Sun className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">SolarNexus</h1>
        </div>
        <Card className="border-border/60 shadow-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Accept your invitation</CardTitle>
            {summary && (
              <p className="text-sm text-muted-foreground">
                You're joining <strong>{summary.orgName}</strong> as{" "}
                <strong>{summary.role}</strong>.
              </p>
            )}
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : loadError ? (
              <div
                role="alert"
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
              >
                {loadError}
              </div>
            ) : summary ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={summary.email} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Your name</Label>
                  <Input
                    id="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={submitting}
                    data-testid="input-accept-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Choose a password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    data-testid="input-accept-password"
                  />
                </div>
                {submitError && (
                  <div
                    role="alert"
                    className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                  >
                    {submitError}
                  </div>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitting || !name.trim() || password.length < 8}
                  data-testid="button-accept-submit"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Joining…
                    </>
                  ) : (
                    "Accept invitation"
                  )}
                </Button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
