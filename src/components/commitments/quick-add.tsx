'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, X, Send } from 'lucide-react';
import type { Organization, CommitmentType, CommitmentCreateInput } from '@/types/database';
import { parseDateFromText } from '@/lib/utils';
import { format } from 'date-fns';

interface QuickAddProps {
  organizations: Organization[];
  onSubmit: (input: CommitmentCreateInput) => Promise<void>;
  isOpen?: boolean;
  onClose?: () => void;
}

const COMMITMENT_TYPES: { value: CommitmentType; label: string }[] = [
  { value: 'note_to_self', label: 'Note' },
  { value: 'promise_made', label: 'Promise' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'ask_received', label: 'Ask' },
  { value: 'deliverable', label: 'Deliverable' },
  { value: 'prep', label: 'Prep' },
  { value: 'internal', label: 'Internal' },
  { value: 'waiting_on', label: 'Waiting On' },
];

export function QuickAdd({ organizations, onSubmit, isOpen: externalOpen, onClose }: QuickAddProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = externalOpen ?? internalOpen;
  const setIsOpen = (open: boolean) => {
    setInternalOpen(open);
    if (!open && onClose) onClose();
  };
  const [title, setTitle] = useState('');
  const [orgId, setOrgId] = useState('');
  const [commitmentType, setCommitmentType] = useState<CommitmentType>('note_to_self');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [suggestedOrg, setSuggestedOrg] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  // Auto-suggest org from title text
  useEffect(() => {
    if (!title || orgId) return;
    const lower = title.toLowerCase();
    const match = organizations.find(
      (org) =>
        lower.includes(org.name.toLowerCase()) ||
        org.name.toLowerCase().split(' ').some((word) => word.length > 3 && lower.includes(word.toLowerCase()))
    );
    setSuggestedOrg(match?.id || '');
  }, [title, organizations, orgId]);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      // Auto-parse date from title
      const parsedDate = parseDateFromText(title);
      const finalDue = dueDate || (parsedDate ? format(parsedDate, 'yyyy-MM-dd') : undefined);

      await onSubmit({
        title: title.trim(),
        commitment_type: commitmentType,
        org_id: orgId || suggestedOrg || undefined,
        due_date: finalDue ? new Date(finalDue).toISOString() : undefined,
        owner: commitmentType === 'waiting_on' ? 'other' : 'josh',
      });

      setTitle('');
      setOrgId('');
      setCommitmentType('note_to_self');
      setDueDate('');
      setSuggestedOrg('');
      setIsOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-primary hover:bg-primary-hover rounded-full shadow-lg shadow-primary/25 flex items-center justify-center text-white transition-all hover:scale-105 active:scale-95 z-40 sm:hidden"
      >
        <Plus className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-card rounded-t-xl sm:rounded-xl w-full max-w-lg p-4 space-y-3 animate-in slide-in-from-bottom sm:slide-in-from-bottom-0">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Quick Add</h3>
          <button onClick={() => setIsOpen(false)} className="text-muted hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder='e.g. "Send Travis the ALIGN deck by Friday"'
          className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm placeholder:text-muted/50 focus:outline-none focus:border-primary"
        />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted block mb-1">Client</label>
            <select
              value={orgId || suggestedOrg}
              onChange={(e) => setOrgId(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            {suggestedOrg && !orgId && (
              <p className="text-xs text-primary mt-0.5">Auto-matched</p>
            )}
          </div>

          <div>
            <label className="text-xs text-muted block mb-1">Type</label>
            <select
              value={commitmentType}
              onChange={(e) => setCommitmentType(e.target.value as CommitmentType)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            >
              {COMMITMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted block mb-1">Due date (optional)</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={!title.trim() || submitting}
          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <Send className="w-4 h-4" />
          {submitting ? 'Adding...' : 'Add Commitment'}
        </button>
      </div>
    </div>
  );
}
