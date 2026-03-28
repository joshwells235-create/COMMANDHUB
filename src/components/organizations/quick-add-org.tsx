'use client';

import { useState, useRef, useEffect } from 'react';
import { X, Send, UserPlus } from 'lucide-react';
import type { OrgStatus, StrategicValue } from '@/types/database';

interface QuickAddOrgProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const STATUS_OPTIONS: { value: OrgStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'paused', label: 'Paused' },
];

const STRATEGIC_OPTIONS: { value: StrategicValue; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'strategic', label: 'Strategic' },
  { value: 'emerging', label: 'Emerging' },
];

export function QuickAddOrg({ isOpen, onClose, onSuccess }: QuickAddOrgProps) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [status, setStatus] = useState<OrgStatus>('active');
  const [strategicValue, setStrategicValue] = useState<StrategicValue>('standard');
  const [notes, setNotes] = useState('');
  const [showContact, setShowContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && nameRef.current) {
      nameRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const resetForm = () => {
    setName('');
    setIndustry('');
    setStatus('active');
    setStrategicValue('standard');
    setNotes('');
    setShowContact(false);
    setContactName('');
    setContactRole('');
    setContactEmail('');
    setError('');
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError('');

    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        industry: industry.trim() || undefined,
        status,
        strategic_value: strategicValue,
        notes: notes.trim() || undefined,
      };

      if (showContact && contactName.trim()) {
        payload.contacts = [
          {
            name: contactName.trim(),
            role: contactRole.trim() || undefined,
            email: contactEmail.trim() || undefined,
          },
        ];
      }

      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create organization');
        return;
      }

      resetForm();
      onSuccess();
      onClose();
    } catch {
      setError('Failed to create organization');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-card rounded-t-xl sm:rounded-xl w-full max-w-lg p-4 space-y-3 animate-in slide-in-from-bottom sm:slide-in-from-bottom-0">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Add Client</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Name */}
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Organization name *"
          className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm placeholder:text-muted/50 focus:outline-none focus:border-primary"
        />

        {/* Industry + Status */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted block mb-1">Industry</label>
            <input
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. Technology"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted/50 focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OrgStatus)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Strategic Value */}
        <div>
          <label className="text-xs text-muted block mb-1">Strategic Value</label>
          <select
            value={strategicValue}
            onChange={(e) => setStrategicValue(e.target.value as StrategicValue)}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm"
          >
            {STRATEGIC_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs text-muted block mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
            rows={2}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted/50 focus:outline-none focus:border-primary resize-none"
          />
        </div>

        {/* Contact toggle */}
        {!showContact ? (
          <button
            onClick={() => setShowContact(true)}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover transition-colors"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add first contact
          </button>
        ) : (
          <div className="border border-border/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted font-medium">First Contact</span>
              <button
                onClick={() => {
                  setShowContact(false);
                  setContactName('');
                  setContactRole('');
                  setContactEmail('');
                }}
                className="text-muted hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Contact name"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted/50 focus:outline-none focus:border-primary"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={contactRole}
                onChange={(e) => setContactRole(e.target.value)}
                placeholder="Role"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted/50 focus:outline-none focus:border-primary"
              />
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Email"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted/50 focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!name.trim() || submitting}
          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <Send className="w-4 h-4" />
          {submitting ? 'Creating...' : 'Create Client'}
        </button>
      </div>
    </div>
  );
}
