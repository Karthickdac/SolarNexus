import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun, Loader2, ArrowLeft } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
      await fetch(`${base}/api/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      /* swallow — we always show the same success message */
    } finally {
      setSubmitting(false);
      setDone(true);
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
            <CardTitle className="text-xl">Reset your password</CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter your email and we'll send you a link to choose a new
              password.
            </p>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="space-y-4">
                <div
                  role="status"
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  If an account exists for {email}, a password reset link is
                  on its way. The link is valid for 30 minutes.
                </div>
                <Link href="/login">
                  <Button variant="outline" className="w-full">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    data-testid="input-forgot-email"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitting || !email.trim()}
                  data-testid="button-forgot-submit"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    "Send reset link"
                  )}
                </Button>
                <Link href="/login">
                  <Button type="button" variant="ghost" className="w-full">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to sign in
                  </Button>
                </Link>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
