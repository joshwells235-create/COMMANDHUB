'use client';

import { useState } from 'react';
import { Check, Clock, X, AlertTriangle, Pencil, Save, Loader2 } from 'lucide-react';
import type { Commitment, CommitmentType } from '@/types/database';
import { getDueLabel, getCommitmentTypeLabel, getEscalationIndicator, cn } from '@/lib/utils';
import { SnoozePicker } from '@/components/ui/snooze-picker';
import { formatDistanceToNow } from 'date-fns';

const COMMITMENT_TYPES: { value: CommitmentType; label: string }[] = [
  { value: 'promise_made', label: 'Promise Made' },
  { value: 'ask_received', label: 'Ask Received' },
  { value: 'follow_up', label: 'Follow Up' },
  { value: 'waiting_on', label: 'Waiting On' },
  { value: 'deliverable', label: 'Deliverable' },
  { value: 'prep', label: 'Prep' },
  { value: 'internal', label: 'Internal' },
  { value: 'note_to_self', label: 'Note to Self' },
];

interface CommitmentListProps {
  commitments: Commitment[];
  title: string;
  emptyMessage?: string;
  onComplete: (id: string) => void;
  onSnooze: (id: string, date: string) => void;
  onCancel: (id: string) => void;
  onUpdate?: (id: string, updates: Record<string, unknown>) => Promise<void>;
  showActions?: boolean;
}

export function CommitmentList({
  commitments,
  title,
  emptyMessage = 'Nothing here.',
  onComplete,
  onSnooze,
  onCancel,
  onUpdate,
  showActions = true,
}: CommitmentListProps) {
  const [snoozeTarget, setSnoozeTarget] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);

  function startEditing(c: Commitment) {
    setEditingId(c.id);
    setEditFields({
      title: c.title,
      description: c.description || '',
      commitment_type: c.commitment_type,
      due_date: c.due_date ? c.due_date.split('T')[0] : '',
      owner: c.owner,
      other_party: c.other_party || '',
    });
  }

  async function saveEdit(id: string) {
    if (!onUpdate) return;
    setSaving(true);
    try {
      await onUpdate(id, {
        title: editFields.title,
        description: editFields.description || null,
        commitment_type: editFields.commitment_type,
        due_date: editFields.due_date || null,
        owner: editFields.owner,
        other_party: editFields.other_party || null,
      });
      setEditingId(null);
    } catch {
      // stay in edit mode on error
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="section-title mb-3">
        {title} ({commitments.length})
      </h2>

      {commitments.length === 0 ? (
        <p className="text-sm text-muted/60 py-3">{emptyMessage}</p>
      ) : (
        <div className="space-y-1">
          {commitments.map((c) => {
            const escalation = getEscalationIndicator(c.escalation_level);
            const dueLabel = getDueLabel(c.due_date, c.status);
            const isOverdue = c.due_date && new Date(c.due_date) < new Date();
            const isExpanded = expandedId === c.id;
            const isEditing = editingId === c.id;
            const ageLabel = !c.due_date
              ? `${formatDistanceToNow(new Date(c.created_at))} old`
              : '';

            return (
              <div
                key={c.id}
                className="bg-card rounded-lg hover:bg-card-hover transition-all border border-transparent hover:border-border"
              >
                <button
                  onClick={() => {
                    if (!isEditing) setExpandedId(isExpanded ? null : c.id);
                  }}
                  className="w-full text-left px-4 py-3 flex items-start gap-3"
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {escalation ? (
                      <span className="text-danger font-bold text-xs">{escalation}</span>
                    ) : (
                      <div className="w-1.5 h-1.5 mt-1.5 rounded-full bg-muted/40" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight truncate">{c.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-muted">
                      {c.category === 'personal' && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 text-[10px] font-medium uppercase tracking-wide">Personal</span>
                      )}
                      {c.organization && <span>{c.organization.name}</span>}
                      {(c.organization || c.category === 'personal') && (dueLabel || ageLabel) && <span>&middot;</span>}
                      {dueLabel && (
                        <span className={cn(isOverdue && 'text-danger')}>{dueLabel}</span>
                      )}
                      {!dueLabel && ageLabel && <span>{ageLabel}</span>}
                    </div>
                  </div>

                  <span className={cn('text-xs mt-0.5 flex-shrink-0', isOverdue ? 'text-danger' : 'text-muted')}>
                    {getCommitmentTypeLabel(c.commitment_type)}
                  </span>
                </button>

                {isExpanded && showActions && !isEditing && (
                  <div className="px-4 pb-3">
                    {c.description && (
                      <p className="text-xs text-muted mb-2">{c.description}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onComplete(c.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-success/20 text-success rounded-md text-xs font-medium hover:bg-success/30"
                      >
                        <Check className="w-3 h-3" /> Done
                      </button>
                      <button
                        onClick={() => setSnoozeTarget(c.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-warning/20 text-warning rounded-md text-xs font-medium hover:bg-warning/30"
                      >
                        <Clock className="w-3 h-3" /> Snooze
                      </button>
                      <button
                        onClick={() => onCancel(c.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-danger/20 text-danger rounded-md text-xs font-medium hover:bg-danger/30"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                      {onUpdate && (
                        <button
                          onClick={() => startEditing(c)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-primary/20 text-primary rounded-md text-xs font-medium hover:bg-primary/30 ml-auto"
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {isEditing && (
                  <div className="px-4 pb-4 space-y-2">
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Title</label>
                      <input
                        type="text"
                        value={editFields.title || ''}
                        onChange={(e) => setEditFields({ ...editFields, title: e.target.value })}
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted uppercase tracking-wide">Description</label>
                      <textarea
                        value={editFields.description || ''}
                        onChange={(e) => setEditFields({ ...editFields, description: e.target.value })}
                        rows={2}
                        className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:border-primary resize-y"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted uppercase tracking-wide">Type</label>
                        <select
                          value={editFields.commitment_type || ''}
                          onChange={(e) => setEditFields({ ...editFields, commitment_type: e.target.value })}
                          className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
                        >
                          {COMMITMENT_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted uppercase tracking-wide">Due Date</label>
                        <input
                          type="date"
                          value={editFields.due_date || ''}
                          onChange={(e) => setEditFields({ ...editFields, due_date: e.target.value })}
                          className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted uppercase tracking-wide">Owner</label>
                        <select
                          value={editFields.owner || 'josh'}
                          onChange={(e) => setEditFields({ ...editFields, owner: e.target.value })}
                          className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
                        >
                          <option value="josh">Josh</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted uppercase tracking-wide">Other Party</label>
                        <input
                          type="text"
                          value={editFields.other_party || ''}
                          onChange={(e) => setEditFields({ ...editFields, other_party: e.target.value })}
                          placeholder="Name..."
                          className="w-full bg-background border border-border rounded-md px-2.5 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => saveEdit(c.id)}
                        disabled={saving || !editFields.title?.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 btn-gradient text-white rounded-md text-xs font-medium disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-card-hover text-muted rounded-md text-xs font-medium hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {snoozeTarget && (
        <SnoozePicker
          onSnooze={(date) => {
            onSnooze(snoozeTarget, date);
            setSnoozeTarget(null);
          }}
          onClose={() => setSnoozeTarget(null)}
        />
      )}
    </div>
  );
}
