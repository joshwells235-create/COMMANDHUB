'use client';

import { useMemo, useState } from 'react';
import { format, differenceInDays, subDays } from 'date-fns';

interface TimelineEvent {
  date: string;
  type: 'transcript' | 'commitment' | 'calendar';
  title: string;
  id: string;
}

interface InteractionTimelineProps {
  events: TimelineEvent[];
  days?: number;
}

const typeConfig = {
  transcript: { color: '#06b6d4', label: 'Session' },
  commitment: { color: '#22c55e', label: 'Completed' },
  calendar: { color: '#8b5cf6', label: 'Meeting' },
};

export function InteractionTimeline({ events, days = 90 }: InteractionTimelineProps) {
  const [hoveredEvent, setHoveredEvent] = useState<TimelineEvent | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const now = new Date();
  const startDate = subDays(now, days);

  const validEvents = useMemo(
    () =>
      events
        .filter((e) => new Date(e.date) >= startDate)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [events, startDate]
  );

  if (validEvents.length === 0) return null;

  const width = 100; // percentage

  // Month markers
  const months: { label: string; pos: number }[] = [];
  for (let d = new Date(startDate); d <= now; d.setMonth(d.getMonth() + 1)) {
    const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    if (firstOfMonth >= startDate && firstOfMonth <= now) {
      const pos = (differenceInDays(firstOfMonth, startDate) / days) * width;
      months.push({ label: format(firstOfMonth, 'MMM'), pos });
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-muted">{format(startDate, 'MMM d')}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          {Object.entries(typeConfig).map(([key, cfg]) => (
            <div key={key} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cfg.color }} />
              <span className="text-[10px] text-muted">{cfg.label}</span>
            </div>
          ))}
        </div>
        <span className="text-xs text-muted">Today</span>
      </div>

      <div className="relative h-10 bg-card rounded-lg border border-border overflow-visible">
        {/* Month gridlines */}
        {months.map((m) => (
          <div
            key={m.label}
            className="absolute top-0 bottom-0 border-l border-border/30"
            style={{ left: `${m.pos}%` }}
          >
            <span className="absolute -top-4 left-0.5 text-[9px] text-muted/50">{m.label}</span>
          </div>
        ))}

        {/* Center line */}
        <div className="absolute top-1/2 left-0 right-0 h-px bg-border/50" />

        {/* Event dots */}
        {validEvents.map((event, i) => {
          const dayOffset = differenceInDays(new Date(event.date), startDate);
          const pos = (dayOffset / days) * width;
          const cfg = typeConfig[event.type as keyof typeof typeConfig] || typeConfig.transcript;

          return (
            <div
              key={`${event.type}-${event.id}-${i}`}
              className="absolute top-1/2 -translate-y-1/2 cursor-pointer transition-transform hover:scale-150"
              style={{ left: `${Math.min(pos, 99)}%` }}
              onMouseEnter={(e) => {
                setHoveredEvent(event);
                const rect = e.currentTarget.getBoundingClientRect();
                const parentRect = e.currentTarget.parentElement?.getBoundingClientRect();
                if (parentRect) {
                  setTooltipPos({ x: rect.left - parentRect.left, y: -8 });
                }
              }}
              onMouseLeave={() => setHoveredEvent(null)}
            >
              <div
                className="w-2.5 h-2.5 rounded-full ring-2 ring-background"
                style={{ backgroundColor: cfg.color }}
              />
            </div>
          );
        })}

        {/* Tooltip */}
        {hoveredEvent && (
          <div
            className="absolute z-10 bg-background border border-border rounded-lg px-3 py-2 shadow-xl pointer-events-none whitespace-nowrap"
            style={{
              left: `${tooltipPos.x}px`,
              bottom: '100%',
              marginBottom: '8px',
              transform: 'translateX(-50%)',
            }}
          >
            <p className="text-xs font-medium">{hoveredEvent.title}</p>
            <p className="text-[10px] text-muted">
              {format(new Date(hoveredEvent.date), 'MMM d, yyyy')} &middot;{' '}
              {(typeConfig[hoveredEvent.type as keyof typeof typeConfig] || typeConfig.transcript).label}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
