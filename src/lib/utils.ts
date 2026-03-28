import { formatDistanceToNow, format, isToday, isTomorrow, isThisWeek, addDays, startOfDay, endOfWeek } from 'date-fns';

export function getEscalationIndicator(escalationLevel: number): string {
  if (escalationLevel >= 3) return '!!!';
  if (escalationLevel >= 2) return '!!';
  if (escalationLevel >= 1) return '!';
  return '';
}

export function getDueLabel(dueDate: string | null, status: string): string {
  if (!dueDate) return '';
  const due = new Date(dueDate);
  const now = new Date();

  if (status === 'completed') return `completed`;

  if (due < now) {
    return `${formatDistanceToNow(due)} overdue`;
  }
  if (isToday(due)) return 'due today';
  if (isTomorrow(due)) return 'due tomorrow';
  if (isThisWeek(due)) return `due ${format(due, 'EEEE')}`;
  return `due ${format(due, 'MMM d')}`;
}

export function getCommitmentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    promise_made: 'Promise',
    ask_received: 'Ask',
    follow_up: 'Follow Up',
    waiting_on: 'Waiting',
    deliverable: 'Deliverable',
    prep: 'Prep',
    internal: 'Internal',
    note_to_self: 'Note',
  };
  return labels[type] || type;
}

export function getCommitmentTypeColor(type: string): string {
  const colors: Record<string, string> = {
    promise_made: 'text-blue-400',
    ask_received: 'text-purple-400',
    follow_up: 'text-yellow-400',
    waiting_on: 'text-orange-400',
    deliverable: 'text-red-400',
    prep: 'text-cyan-400',
    internal: 'text-gray-400',
    note_to_self: 'text-gray-500',
  };
  return colors[type] || 'text-gray-400';
}

export function parseDateFromText(text: string): Date | null {
  const lower = text.toLowerCase();
  const today = startOfDay(new Date());

  if (lower.includes('today')) return today;
  if (lower.includes('tomorrow')) return addDays(today, 1);
  if (lower.includes('next week')) return addDays(today, 7);
  if (lower.includes('this week') || lower.includes('end of week')) return endOfWeek(today);

  const dayMatch = lower.match(/by (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (dayMatch) {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = dayNames.indexOf(dayMatch[1]);
    const currentDay = today.getDay();
    const daysUntil = targetDay > currentDay ? targetDay - currentDay : 7 - (currentDay - targetDay);
    return addDays(today, daysUntil);
  }

  return null;
}

export function formatEventTime(dateStr: string): string {
  return format(new Date(dateStr), 'h:mma').toLowerCase();
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
