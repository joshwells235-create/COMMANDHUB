'use client';

import { useState } from 'react';
import { HeartPulse, Activity, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RelationshipHealth } from './relationship-health';
import { LifecycleTracker } from './lifecycle-tracker';
import { PracticeIntelligence } from './practice-intelligence';
import { ThemeAlerts } from './theme-alerts';

type Tab = 'health' | 'lifecycle' | 'insights';

const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'health', label: 'Health', icon: HeartPulse },
  { key: 'lifecycle', label: 'Lifecycle', icon: Activity },
  { key: 'insights', label: 'Insights', icon: Brain },
];

export function IntelligencePanel() {
  const [activeTab, setActiveTab] = useState<Tab>('health');

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
        Alerts & Health
      </h2>

      {/* Tab buttons */}
      <div className="flex gap-1 mb-4">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                activeTab === tab.key
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted hover:text-foreground hover:bg-card-hover'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="max-h-[400px] overflow-y-auto">
        {activeTab === 'health' && <RelationshipHealth />}
        {activeTab === 'lifecycle' && <LifecycleTracker />}
        {activeTab === 'insights' && (
          <div className="space-y-4">
            <PracticeIntelligence />
            <ThemeAlerts />
          </div>
        )}
      </div>
    </div>
  );
}
