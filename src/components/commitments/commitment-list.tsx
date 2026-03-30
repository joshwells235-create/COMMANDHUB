'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Check, Clock, X, AlertTriangle, Pencil, Save, Loader2, CheckCircle2, Target, GripVertical, FileText, Mail, Calendar, History } from 'lucide-react';
import type { Commitment, CommitmentType, CommitmentActivity } from '@/types/database';
import { getDueLabel, getCommitmentTypeLabel, getEscalationIndicator, cn } from '@/lib/utils';
import { SnoozePicker } from '@/components/ui/snooze-picker';
import { formatDistanceToNow, differenceInDays } from 'date-fns';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
  sortable?: boolean;
}

function SortableHandle() {
  return (
    <div className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted/40 hover:text-muted touch-none">
      <GripVertical className="w-3.5 h-3.5" />
    </div>
  );
}

function SortableWrapper({ id, children, disabled }: { id: string; children: React.ReactNode; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

function SourceBadge({ sourceType }: { sourceType: string | null }) {
  if (!sourceType) return null;

  const config: Record<string, { icon: typeof FileText; label: string; className: string }> = {
    transcript: { icon: FileText, label: 'Transcript', className: 'text-indigo-400 bg-indigo-400/10' },
    email: { icon: Mail, label: 'Email', className: 'text-blue-400 bg-blue-400/10' },
    calendar: { icon: Calendar, label: 'Calendar', className: 'text-amber-400 bg-amber-400/10' },
  };

  const badge = config[sourceType];
  if (!badge) return null;

  const Icon = badge.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded', badge.className)}>
      <Icon className="w-2.5 h-2.5" />
      {badge.label}
    </span>
  );
}

function buildPriorityTitle(c: Commitment): string {
  const factors: string[] = [];

  if (c.due_date) {
    const now = new Date();
    const due = new Date(c.due_date);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diff = differenceInDays(dueDay, today);

    if (diff < 0) {
      factors.push(`Overdue by ${Math.abs(diff)} day${Math.abs(diff) !== 1 ? 's' : ''} (+${Math.min(Math.abs(diff) * 5, 30)} points)`);
    } else if (diff === 0) {
      factors.push('Due today (+15 points)');
    } else if (diff === 1) {
      factors.push('Due tomorrow (+10 points)');
    }
  }

  if (c.commitment_type === 'promise_made') {
    factors.push('Promise made (+10)');
  }

  if (c.source_type === 'email') {
    factors.push('From email');
  } else if (c.source_type === 'calendar') {
    factors.push('From calendar prep');
  }

  if (factors.length === 0) {
    return `Priority: ${c.priority_score}`;
  }

  return `Priority: ${c.priority_score}\n${factors.join('\n')}`;
}

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

function ActivityHistory({ commitmentId, activityCache }: { commitmentId: string; activityCache: React.RefObject<Map<string, CommitmentActivity[]>> }) {
  const [activities, setActivities] = useState<CommitmentActivity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchActivities = useCallback(async () => {
    // Check cache first
    const cached = activityCache.current?.get(commitmentId);
    if (cached) {
      setActivities(cached);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/activity?commitment_id=${commitmentId}&limit=20`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data: CommitmentActivity[] = await res.json();
      activityCache.current?.set(commitmentId, data);
      setActivities(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [commitmentId, activityCache]);

  // Fetch on mount
  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading history...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-danger/70 py-2">Failed to load activity history.</div>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <div className="text-xs text-muted/60 py-2">No activity recorded.</div>
    );
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
            <div className="pb-2.5 min-w-0">
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

export function CommitmentList({
  commitments,
  title,
  emptyMessage = 'Nothing here.',
  onComplete,
  onSnooze,
  onCancel,
  onUpdate,
  showActions = true,
  sortable = false,
}: CommitmentListProps) {
  const [snoozeTarget, setSnoozeTarget] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const activityCacheRef = useRef<Map<string, CommitmentActivity[]>>(new Map());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const orderedCommitments = localOrder
    ? localOrder.map((id) => commitments.find((c) => c.id === id)).filter(Boolean) as Commitment[]
    : commitments;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedCommitments.findIndex((c) => c.id === active.id);
    const newIndex = orderedCommitments.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = [...orderedCommitments.map((c) => c.id)];
    newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, active.id as string);
    setLocalOrder(newOrder);

    // Calculate new priority score based on neighbors
    if (onUpdate) {
      const aboveScore = newIndex > 0 ? (orderedCommitments[newIndex > oldIndex ? newIndex : newIndex - 1]?.priority_score ?? 50) : 100;
      const belowScore = newIndex < orderedCommitments.length - 1 ? (orderedCommitments[newIndex < oldIndex ? newIndex : newIndex + 1]?.priority_score ?? 0) : 0;
      const newScore = Math.round((aboveScore + belowScore) / 2);
      onUpdate(active.id as string, { priority_score: newScore, manual_priority_override: true });
    }
  }

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
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="w-8 h-8 text-success/40 mb-2" />
          <p className="text-sm text-muted">{emptyMessage}</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedCommitments.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1">
          {orderedCommitments.map((c) => {
            const escalation = getEscalationIndicator(c.escalation_level);
            const dueLabel = getDueLabel(c.due_date, c.status);
            const isOverdue = c.due_date && new Date(c.due_date) < new Date();
            const isExpanded = expandedId === c.id;
            const isEditing = editingId === c.id;
            const ageLabel = !c.due_date
              ? `${formatDistanceToNow(new Date(c.created_at))} old`
              : '';

            return (
              <SortableWrapper key={c.id} id={c.id} disabled={!sortable || !!editingId}>
              <div
                className="bg-card rounded-lg hover:bg-card-hover transition-all border border-transparent hover:border-border"
              >
                <button
                  onClick={() => {
                    if (!isEditing) setExpandedId(isExpanded ? null : c.id);
                  }}
                  className="w-full text-left px-4 py-3 flex items-start gap-3"
                >
                  {sortable && (
                    <div className="flex-shrink-0 mt-1">
                      <SortableHandle />
                    </div>
                  )}
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

                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                    <span className={cn('text-xs', isOverdue ? 'text-danger' : 'text-muted')}>
                      {getCommitmentTypeLabel(c.commitment_type)}
                    </span>
                    <SourceBadge sourceType={c.source_type} />
                    <span
                      className="text-[10px] text-muted/60 tabular-nums"
                      title={buildPriorityTitle(c)}
                    >
                      {c.priority_score}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setHistoryId(historyId === c.id ? null : c.id);
                      }}
                      className={cn(
                        'p-1 rounded hover:bg-card-hover transition-colors',
                        historyId === c.id ? 'text-primary' : 'text-muted/40 hover:text-muted'
                      )}
                      title="Activity history"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                  </div>
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

                {historyId === c.id && (
                  <div className="px-4 pb-3 border-t border-border/30">
                    <div className="flex items-center gap-1.5 pt-2.5 pb-2">
                      <History className="w-3 h-3 text-muted/60" />
                      <span className="text-[10px] text-muted/60 uppercase tracking-wide font-medium">Activity History</span>
                    </div>
                    <div className="border-l-2 border-primary/20 pl-3 ml-0.5">
                      <ActivityHistory commitmentId={c.id} activityCache={activityCacheRef} />
                    </div>
                  </div>
                )}
              </div>
              </SortableWrapper>
            );
          })}
        </div>
        </SortableContext>
        </DndContext>
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
