'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

interface KeyboardShortcutsProps {
  onOpenCommandPalette?: () => void;
  onOpenQuickAdd?: () => void;
  onOpenChat?: () => void;
}

const SHORTCUTS = [
  { keys: ['⌘', 'K'], description: 'Command palette' },
  { keys: ['G', 'H'], description: 'Go to Dashboard' },
  { keys: ['G', 'C'], description: 'Go to Clients' },
  { keys: ['G', 'T'], description: 'Go to Transcripts' },
  { keys: ['G', 'M'], description: 'Go to Commitments' },
  { keys: ['G', 'F'], description: 'Go to Follow-ups' },
  { keys: ['G', 'A'], description: 'Go to Analytics' },
  { keys: ['G', 'B'], description: 'Go to Briefings' },
  { keys: ['G', 'S'], description: 'Go to Settings' },
  { keys: ['N'], description: 'New commitment' },
  { keys: ['/'], description: 'Open chat' },
  { keys: ['?'], description: 'Show shortcuts' },
  { keys: ['Esc'], description: 'Close dialogs' },
];

export function KeyboardShortcuts({ onOpenCommandPalette, onOpenQuickAdd, onOpenChat }: KeyboardShortcutsProps) {
  const [showHelp, setShowHelp] = useState(false);
  const [gPressed, setGPressed] = useState(false);
  const router = useRouter();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable) {
        return;
      }

      // ? for help
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowHelp((prev) => !prev);
        return;
      }

      // / for chat
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onOpenChat?.();
        return;
      }

      // n for new commitment
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        onOpenQuickAdd?.();
        return;
      }

      // G prefix for navigation
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey) {
        setGPressed(true);
        setTimeout(() => setGPressed(false), 1500);
        return;
      }

      if (gPressed) {
        setGPressed(false);
        const routes: Record<string, string> = {
          h: '/',
          c: '/clients',
          t: '/transcripts',
          m: '/commitments',
          f: '/follow-ups',
          a: '/analytics',
          b: '/briefings',
          s: '/settings',
        };
        const route = routes[e.key];
        if (route) {
          e.preventDefault();
          router.push(route);
        }
      }
    },
    [gPressed, router, onOpenChat, onOpenQuickAdd]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!showHelp) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setShowHelp(false)} />
      <div className="fixed top-[15%] left-1/2 -translate-x-1/2 z-50 w-full max-w-md">
        <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden" style={{ background: 'rgba(14, 21, 38, 0.98)' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Keyboard Shortcuts</h2>
            <button onClick={() => setShowHelp(false)} className="text-muted hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-4 py-3 space-y-2 max-h-[60vh] overflow-y-auto">
            {SHORTCUTS.map((s, i) => (
              <div key={i} className="flex items-center justify-between py-1">
                <span className="text-sm text-muted">{s.description}</span>
                <div className="flex items-center gap-1">
                  {s.keys.map((k, j) => (
                    <span key={j}>
                      {j > 0 && <span className="text-[10px] text-muted/50 mx-0.5">then</span>}
                      <kbd className="inline-flex items-center px-1.5 py-0.5 bg-background border border-border rounded text-[11px] text-muted font-mono min-w-[24px] justify-center">
                        {k}
                      </kbd>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 border-t border-border text-[10px] text-muted text-center">
            Press <kbd className="px-1 py-0.5 bg-background border border-border rounded text-[10px]">?</kbd> to toggle
          </div>
        </div>
      </div>
    </>
  );
}
