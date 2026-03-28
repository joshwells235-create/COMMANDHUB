'use client';

import { useState } from 'react';
import { Zap, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });

      if (res.ok) {
        window.location.href = '/';
      } else {
        setError('Invalid passphrase');
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      {/* Animated background orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-20 blur-3xl login-orb-1" style={{ background: 'radial-gradient(circle, rgba(6, 182, 212, 0.3), transparent)' }} />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full opacity-15 blur-3xl login-orb-2" style={{ background: 'radial-gradient(circle, rgba(129, 140, 248, 0.25), transparent)' }} />

      <div className="w-full max-w-sm relative z-10">
        <div className="glass rounded-2xl p-8 glow animate-fade-in relative animated-gradient-border">
          <div className="flex items-center justify-center gap-2 mb-8">
            <Zap className="w-7 h-7 text-primary pulse-alive" />
            <h1 className="text-xl font-semibold tracking-tight text-gradient">COMMAND HUB</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="passphrase" className="block text-xs font-light uppercase tracking-[0.15em] text-foreground-secondary mb-2">
                Passphrase
              </label>
              <input
                id="passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter your passphrase"
                autoFocus
                required
                className="w-full px-4 py-3 bg-background/60 border border-border rounded-xl text-foreground placeholder:text-muted/40 focus:outline-none focus:border-primary/50 transition-all"
              />
            </div>

            {error && (
              <p className="text-sm text-danger">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !passphrase}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 btn-gradient disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
