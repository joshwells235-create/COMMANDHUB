'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Target,
  Check,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  Pencil,
  Save,
  Loader2,
  FileText,
  Mail,
  Calendar,
  History,
} from 'lucide-react';
import type { Commitment, CommitmentType, CommitmentActivity } from '@/types/database';
import { getDueLabel, getCommitmentTypeLabel, getEscalationIndicator, cn } from '@/lib/utils';
import { SnoozePicker } from '@/components/ui/snooze-picker';
import { formatDistanceToNow, differenceInDays } from 'date-fns';

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

const SOURCE_CONFIG: Record<string, { icon: typeof FileText; label: string; className: string }> = {
  transcript: { icon: FileText, label: 'From Transcript', className: 'text-indigo-400 bg-indigo-400/10' },
  email: { icon: Mail, label: 'From Email', className: 'text-blue-400 bg-blue-400/10' },
  calendar: { icon: Calendar, label: 'From Calendar', className: 'text-amber-400 bg-amber-400/10' },
  follow_up_queue: { icon: Target, label: 'Follow-up', className: 'text-cyan-400 bg-cyan-400/10' },
};

const ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  completed: 'Completed',
  snoozed: 'Snoozed',
  unsnoozed: 'Unsnoozed',
  escalated: 'Escalated',
  'auto-resolved': 'Auto-resolved',
  updated: 'Updated',
  cancelled: 'Cancelled',
  reopened: 'Reopened',
  priority_changed: 'Priority changed',
};

const ACTION_COLORS: Record<string, string> = {
  created: 'bg-primary/60',
  completed: 'bg-success/60',
  snoozed: 'bg-warning/60',
  unsnoozed: 'bg-warning/60',
  escalated: 'bg-danger/60',
  'auto-resolved': 'bg-success/60',
  cancelled: 'bg-danger/60',
  updated: 'bg-indigo-400/60',
  reopened: 'bg-primary/60',
  priority_changed: 'bg-indigo-400/60',
};

interface NextUpCardProps {
  commitment: Commitment | null;
  onComplete: (id: string) => void;
  onSnooze: (id: string, date: string) => void;
  onCancel?: (id: string) => void;
  onUpdate?: (id: string, updates: Record<string, unknown>) => Promise<void>;
}

function buildPriorityBreakdown(c: Commitment): string[] {
  const factors: string[] = [];

  if (c.due_date) {
    const now = new Date();
    const due = new Date(c.due_date);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diff = differenceInDays(dueDay, today);

    if (diff < 0) {
      factors.push(`Overdue by ${Math.abs(diff)} day${Math.abs(diff) !== 1 ? 's' : ''}`);
    } else if (diff === 0) {
      factors.push('Due today');
    } else if (diff === 1) {
      factors.push('Due tomorrow');
    } else if (diff <= 7) {
      factors.push(`Due in ${diff} days`);
    }
  }

  if (c.commitment_type === 'promise_made') {
    factors.push('Promise made — high accountability');
  } else if (c.commitment_type === 'deliverable') {
    factors.push('Deliverable — tangible output expected');
  }

  if (c.escalation_level >= 1) {
    factors.push(`Escalated ${c.escalation_level}x — needs attention`);
  }

  if (c.source_type === 'email') {
    factors.push('Originated from email');
  } else if (c.source_type === 'calendar') {
    factors.push('Created from calendar prep');
  } else if (c.source_type === 'transcript') {
    factors.push('Extracted from coaching session');
  }

  if (c.organization) {
    factors.push(`Client: ${c.organization.name}`);
  }

  return factors;
}

function formatDetails(details: Record<string, unknown> | null): string | null {
  if (!details) return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (value !== null && value !== undefined && value !== '') {
      const label = key.replace(/_/g, ' ');
      parts.push(`${label}: ${typeof value === 'string' ? value.split('T')[0] : String(value)}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function ActivityTimeline({ commitmentId }: { commitmentId: string }) {
  const [activities, setActivities] = useState<CommitmentActivity[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/activity?commitment_id=${commitmentId}&limit=10`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: CommitmentActivity[]) => {
        if (!cancelled) setActivities(data);
      })
      .catch(() => {
        if (!cancelled) setActivities([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [commitmentId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading history...
      </div>
    );
  }

  if (!activities || activities.length === 0) {
    return <div className="text-xs text-muted/60 py-1">No activity recorded.</div>;
  }

  return (
    <div className="space-y-0">
      {activities.map((a) => {
        const dotColor = ACTION_COLORS[a.action] || 'bg-muted/40';
        const details = formatDetails(a.details);
        return (
          <div key={a.id} className="flex items-start gap-2 pl-1">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={cn('w-1.5 h-1.5 rounded-full mt-1.5', dotColor)} />
              <div className="w-px flex-1 bg-border/50" />
            </div>
            <div className="pb-2 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-foreground/80">
                  {ACTION_LABELS[a.action] || a.action}
                </span>
                <span className="text-[10px] text-muted/60">
                  {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                </span>
              </div>
              {details && (
                <p className="text-[10px] text-muted/50 mt-0.5 truncate">{details}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function NextUpCard({ commitment, onComplete, onSnooze, onCancel, onUpdate }: NextUpCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string | null>>({});

  if (!commitment) {
    return (
      <div className="bg-card rounded-xl p-6 border border-border">
        <div className="flex items-center gap-2 text-success">
          <Check className="w-5 h-5" />
          <span className="font-semibold">All Clear</span>
        </div>
        <p className="text-muted mt-1 text-sm">No pending commitments. Nice work.</p>
      </div>
    );
  }

  const dueLabel = getDueLabel(commitment.due_date, commitment.status);
  const isOverdue = commitment.due_date && new Date(commitment.due_date) < new Date();
  const escalation = getEscalationIndicator(commitment.escalation_level);
  const sourceCfg = commitment.source_type ? SOURCE_CONFIG[commitment.source_type] : null;
  const SourceIcon = sourceCfg?.icon;
  const priorityFactors = buildPriorityBreakdown(commitment);
  const ageLabel = formatDistanceToNow(new Date(commitment.created_at), { addSuffix: true });

  function startEditing() {
    setEditFields({
      title: commitment!.title,
      description: commitment!.description || '',
      commitment_type: commitment!.commitment_type,
      due_date: commitment!.due_date ? commitment!.due_date.split('T')[0] : '',
      owner: commitment!.owner,
      other_party: commitment!.other_party || '',
    });
    setIsEditing(true);
    setShowDetails(true);
  }

  async function saveEdit() {
    if (!onUpdate || !commitment) return;
    setSaving(true);
    try {
      await onUpdate(commitment.id, {
        title: editFields.title,
        description: editFields.description || null,
        commitment_type: editFields.commitment_type,
        due_date: editFields.due_date || null,
        owner: editFields.owner,
        other_party: editFields.other_party || null,
      });
      setIsEditing(false);
    } catch {
      // stay in edit mode
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="rounded-xl p-5 relative" style={{ background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.06), rgba(129, 140, 248, 0.03))' }}>
        {/* Header row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-gradient">Next Up</span>
            {escalation && (
              <span className="text-danger font-bold text-xs">{escalation}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] text-muted/60 tabular-nums cursor-help"
              title={`Priority: ${commitment.priority_score}\n${priorityFactors.join('\n')}`}
            >
              {commitment.priority_score} pts
            </span>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                'p-1 rounded hover:bg-card-hover transition-colors',
                showHistory ? 'text-primary' : 'text-muted/40 hover:text-muted'
              )}
              title="Activity history"
            >
              <History className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Title */}
        <h3 className="text-lg font-semibold leading-tight">{commitment.title}</h3>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2 mt-2 text-sm">
          {commitment.category === 'personal' && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[11px] font-medium">Personal</span>
          )}
          {commitment.category === 'internal' && (
            <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 text-[11px] font-medium">Internal</span>
          )}
          {commitment.organization && (
            <span className="text-muted">{commitment.organization.name}</span>
          )}
          <span className="text-muted">&middot;</span>
          <span className="text-muted">{getCommitmentTypeLabel(commitment.commitment_type)}</span>
          {dueLabel && (
            <>
              <span className="text-muted">&middot;</span>
              <span className={isOverdue ? 'text-danger font-medium' : 'text-muted'}>
                {dueLabel}
              </span>
            </>
          )}
          {sourceCfg && SourceIcon && (
            <>
              <span className="text-muted">&middot;</span>
              <span className={cn('inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded', sourceCfg.className)}>
                <SourceIcon className="w-3 h-3" />
                {sourceCfg.label}
              </span>
            </>
          )}
        </div>

        {/* Priority factors (why this is #1) */}
        {priorityFactors.length > 0 && showDetails && !isEditing && (
          <div className="mt-3 space-y-1">
            <span className="text-[10px] text-muted/60 uppercase tracking-wide font-medium">Why this is #1</span>
            <ul className="space-y-0.5">
              {priorityFactors.map((f, i) => (
                <li key={i} className="text-xs text-muted/80 flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-primary/50 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Description (expanded, non-editing) */}
        {showDetails && !isEditing && commitment.description && (
          <p className="mt-3 text-sm text-muted leading-relaxed">{commitment.description}</p>
        )}

        {/* Source snippet */}
        {showDetails && !isEditing && commitment.source_snippet && (
          <div className="mt-2 bg-background/50 rounded-lg px-3 py-2 border border-border/30">
            <span className="text-[10px] text-muted/60 uppercase tracking-wide font-medium">Original context</span>
            <p className="text-xs text-muted/80 mt-1 italic leading-relaxed">&ldquo;{commitment.source_snippet}&rdquo;</p>
          </div>
        )}

        {/* Created timestamp */}
        {showDetails && !isEditing && (
          <p className="mt-2 text-[10px] text-muted/40">Created {ageLabel}{commitment.other_party ? ` · Other party: ${commitment.other_party}` : ''}</p>
        )}

        {/* Edit form */}
        {isEditing && (
          <div className="mt-4 space-y-2">
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
                onClick={saveEdit}
                disabled={saving || !editFields.title?.trim()}
                className="flex items-center gap-1 px-3 py-1.5 btn-gradient text-white rounded-md text-xs font-medium disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="flex items-center gap-1 px-3 py-1.5 bg-card-hover text-muted rounded-md text-xs font-medium hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Activity History */}
        {showHistory && (
          <div className="mt-3 border-t border-border/30 pt-3">
            <div className="flex items-center gap-1.5 pb-2">
              <History className="w-3 h-3 text-muted/60" />
              <span className="text-[10px] text-muted/60 uppercase tracking-wide font-medium">Activity History</span>
            </div>
            <div className="border-l-2 border-primary/20 pl-3 ml-0.5">
              <ActivityTimeline commitmentId={commitment.id} />
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!isEditing && (
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => onComplete(commitment.id)}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium text-white btn-gradient"
            >
              <Check className="w-4 h-4" />
              Done
            </button>
            <button
              onClick={() => setShowSnooze(true)}
              className="flex-1 flex items-center justify-center gap-2 bg-warning/15 text-warning hover:bg-warning/25 rounded-lg py-2.5 text-sm font-medium transition-all border border-warning/20 hover:border-warning/30"
            >
              <Clock className="w-4 h-4" />
              Snooze
            </button>
            {onUpdate && (
              <button
                onClick={startEditing}
                className="px-3 py-2.5 bg-primary/15 text-primary hover:bg-primary/25 rounded-lg transition-colors border border-primary/20 hover:border-primary/30"
                title="Edit commitment"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            {onCancel && (
              <button
                onClick={() => onCancel(commitment.id)}
                className="px-3 py-2.5 bg-danger/15 text-danger hover:bg-danger/25 rounded-lg transition-colors border border-danger/20 hover:border-danger/30"
                title="Cancel commitment"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="px-3 py-2.5 bg-background hover:bg-card-hover rounded-lg text-muted transition-colors"
            >
              {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        )}
      </div>

      {showSnooze && (
        <SnoozePicker
          onSnooze={(date) => {
            onSnooze(commitment.id, date);
            setShowSnooze(false);
          }}
          onClose={() => setShowSnooze(false)}
        />
      )}
    </>
  );
}
