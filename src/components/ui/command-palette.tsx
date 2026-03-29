'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Users,
  Target,
  FileText,
  Settings,
  PhoneForwarded,
  Plus,
  ArrowRight,
  MessageSquare,
  BarChart3,
} from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: typeof Search;
  action: () => void;
  category: 'navigate' | 'create' | 'client';
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  organizations?: Array<{ id: string; name: string }>;
  onOpenChat?: () => void;
  onOpenQuickAdd?: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  organizations = [],
  onOpenChat,
  onOpenQuickAdd,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const navigate = useCallback(
    (path: string) => {
      onClose();
      router.push(path);
    },
    [onClose, router]
  );

  // Build command list
  const allCommands: CommandItem[] = [
    // Navigation
    { id: 'nav-dashboard', label: 'Dashboard', sublabel: 'Go to home', icon: Target, action: () => navigate('/'), category: 'navigate' },
    { id: 'nav-clients', label: 'Clients', sublabel: 'View all clients', icon: Users, action: () => navigate('/clients'), category: 'navigate' },
    { id: 'nav-commitments', label: 'Commitments', sublabel: 'View all commitments', icon: Target, action: () => navigate('/commitments'), category: 'navigate' },
    { id: 'nav-transcripts', label: 'Transcripts', sublabel: 'Upload & view transcripts', icon: FileText, action: () => navigate('/transcripts'), category: 'navigate' },
    { id: 'nav-followups', label: 'Follow-ups', sublabel: 'Follow-up queue', icon: PhoneForwarded, action: () => navigate('/follow-ups'), category: 'navigate' },
    { id: 'nav-settings', label: 'Settings', sublabel: 'Manage configuration', icon: Settings, action: () => navigate('/settings'), category: 'navigate' },
    { id: 'nav-analytics', label: 'Analytics', sublabel: 'Weekly scorecard', icon: BarChart3, action: () => navigate('/analytics'), category: 'navigate' },
    // Actions
    {
      id: 'act-new-commitment',
      label: 'New Commitment',
      sublabel: 'Quick add a task',
      icon: Plus,
      action: () => { onClose(); onOpenQuickAdd?.(); },
      category: 'create',
    },
    {
      id: 'act-ask',
      label: 'Ask Command Hub',
      sublabel: 'Open AI assistant',
      icon: MessageSquare,
      action: () => { onClose(); onOpenChat?.(); },
      category: 'create',
    },
    // Client shortcuts
    ...organizations.map((org) => ({
      id: `client-${org.id}`,
      label: org.name,
      sublabel: 'Go to client',
      icon: Users,
      action: () => navigate(`/clients/${org.id}`),
      category: 'client' as const,
    })),
  ];

  // Filter commands by query
  const filtered = query.trim()
    ? allCommands.filter((cmd) => {
        const q = query.toLowerCase();
        return (
          cmd.label.toLowerCase().includes(q) ||
          (cmd.sublabel?.toLowerCase().includes(q) ?? false)
        );
      })
    : allCommands.filter((cmd) => cmd.category !== 'client'); // Don't show all clients when empty

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[selectedIndex]) {
            filtered[selectedIndex].action();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filtered, selectedIndex, onClose]);

  if (!isOpen) return null;

  // Group filtered items
  const navItems = filtered.filter((c) => c.category === 'navigate');
  const createItems = filtered.filter((c) => c.category === 'create');
  const clientItems = filtered.filter((c) => c.category === 'client');

  let globalIndex = 0;

  function renderGroup(title: string, items: CommandItem[]) {
    if (items.length === 0) return null;
    const group = (
      <div key={title}>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted px-3 py-1.5">
          {title}
        </p>
        {items.map((item) => {
          const idx = globalIndex++;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={item.action}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                idx === selectedIndex
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:bg-card-hover'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0 text-muted" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.label}</p>
                {item.sublabel && (
                  <p className="text-xs text-muted truncate">{item.sublabel}</p>
                )}
              </div>
              <ArrowRight className="w-3 h-3 text-muted opacity-0 group-hover:opacity-100" />
            </button>
          );
        })}
      </div>
    );
    return group;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Palette */}
      <div className="fixed top-[15%] left-1/2 -translate-x-1/2 z-50 w-full max-w-lg">
        <div className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden" style={{ background: 'rgba(14, 21, 38, 0.98)' }}>
          {/* Search input */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Search className="w-4 h-4 text-muted flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command, page, or client name..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-background border border-border rounded text-[10px] text-muted">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[50vh] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-sm text-muted text-center py-8">
                No results for &ldquo;{query}&rdquo;
              </p>
            ) : (
              <>
                {renderGroup('Actions', createItems)}
                {renderGroup('Navigate', navItems)}
                {renderGroup('Clients', clientItems)}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-border text-[10px] text-muted">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
        </div>
      </div>
    </>
  );
}
