'use client';

import { addDays, addWeeks, format, startOfDay } from 'date-fns';
import { Clock, X } from 'lucide-react';
import { useState } from 'react';

interface SnoozePickerProps {
  onSnooze: (date: string) => void;
  onClose: () => void;
}

export function SnoozePicker({ onSnooze, onClose }: SnoozePickerProps) {
  const [customDate, setCustomDate] = useState('');
  const today = startOfDay(new Date());

  const options = [
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next Week', date: addWeeks(today, 1) },
    { label: 'In 3 Days', date: addDays(today, 3) },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl w-full max-w-sm p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">Snooze Until</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          {options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => onSnooze(opt.date.toISOString())}
              className="w-full text-left px-3 py-2 rounded-lg bg-background hover:bg-card-hover transition-colors text-sm"
            >
              {opt.label}
              <span className="text-muted ml-2">{format(opt.date, 'EEE, MMM d')}</span>
            </button>
          ))}
        </div>

        <div className="pt-2 border-t border-border">
          <label className="text-xs text-muted block mb-1">Custom date</label>
          <div className="flex gap-2">
            <input
              type="date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              min={format(addDays(today, 1), 'yyyy-MM-dd')}
              className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={() => {
                if (customDate) onSnooze(new Date(customDate).toISOString());
              }}
              disabled={!customDate}
              className="px-3 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50"
            >
              Set
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
