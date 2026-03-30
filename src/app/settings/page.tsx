'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Zap,
  ArrowLeft,
  Loader2,
  UserCircle,
  Brain,
  Plug,
  RefreshCw,
  Check,
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Mic,
  Target,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

interface VoiceProfile {
  id: string;
  tone?: string;
  signature_phrases?: string[];
  frameworks_used?: string[];
  updated_at: string;
}

interface MethodologyFramework {
  framework_name: string;
  description: string;
  how_josh_deploys_it?: string;
  sessions_appeared?: string[];
  clients_used_with?: string[];
}

interface SignatureQuestion {
  question_pattern: string;
  variants_seen?: string[];
  what_it_unlocks: string;
  frequency?: string;
}

interface EngagementSequence {
  sequence_name: string;
  steps?: string[];
  description: string;
  sessions_observed?: string[];
}

interface InterventionPattern {
  situation: string;
  josh_response_pattern: string;
  example_instances?: string[];
  effectiveness_notes?: string;
}

interface MetaphorAnalogy {
  metaphor: string;
  description: string;
  when_deployed?: string;
  sessions_used?: string[];
}

interface Methodology {
  named_frameworks?: MethodologyFramework[];
  signature_questions?: SignatureQuestion[];
  engagement_sequences?: EngagementSequence[];
  coaching_sequences?: EngagementSequence[];
  intervention_patterns?: InterventionPattern[];
  metaphors_and_analogies?: MetaphorAnalogy[];
}

interface MethodologyData {
  methodology: Methodology;
  updated_at: string;
}

interface PriorityInsights {
  last_run?: string;
  insights?: string[];
  modifier_rules?: Array<{ rule: string; modifier: number }>;
}

interface JoshProfile {
  id: string;
  profile_type: string;
  data: Record<string, unknown>;
  updated_at: string;
}

const PROFILE_CONFIG: Record<string, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  refreshEndpoint: string | null;
  refreshMethod: string;
}> = {
  coaching_methodology: {
    label: 'Coaching Methodology',
    icon: BookOpen,
    refreshEndpoint: '/api/ai/methodology',
    refreshMethod: 'POST',
  },
  writing_style: {
    label: 'Writing Style',
    icon: Sparkles,
    refreshEndpoint: '/api/ai/voice-profile',
    refreshMethod: 'POST',
  },
  coaching_voice: {
    label: 'Voice Profile',
    icon: Mic,
    refreshEndpoint: '/api/ai/voice-profile',
    refreshMethod: 'POST',
  },
  priority_patterns: {
    label: 'Priority Patterns',
    icon: Target,
    refreshEndpoint: null,
    refreshMethod: 'POST',
  },
  cross_client_patterns: {
    label: 'Cross-Client Patterns',
    icon: Brain,
    refreshEndpoint: '/api/ai/cross-client',
    refreshMethod: 'POST',
  },
};

export default function SettingsPage() {
  // Voice Profile state
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile | null>(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceGenerating, setVoiceGenerating] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Engagement Methodology state
  const [methodologyData, setMethodologyData] = useState<MethodologyData | null>(null);
  const [methodologyLoading, setMethodologyLoading] = useState(false);
  const [methodologyGenerating, setMethodologyGenerating] = useState(false);
  const [methodologyError, setMethodologyError] = useState<string | null>(null);
  const [methodologyExpanded, setMethodologyExpanded] = useState<Record<string, boolean>>({});

  // Priority Learning state
  const [priorityInsights, setPriorityInsights] = useState<PriorityInsights | null>(null);
  const [priorityLoading, setPriorityLoading] = useState(false);
  const [priorityRunning, setPriorityRunning] = useState(false);
  const [priorityError, setPriorityError] = useState<string | null>(null);

  // Microsoft connection state
  const [msConnected, setMsConnected] = useState(false);
  const [msLoading, setMsLoading] = useState(true);

  // AI Intelligence state
  const [profiles, setProfiles] = useState<JoshProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [refreshingProfile, setRefreshingProfile] = useState<string | null>(null);
  const [expandedProfiles, setExpandedProfiles] = useState<Record<string, boolean>>({});

  // Fetch voice profile on mount
  useEffect(() => {
    fetchVoiceProfile();
    fetchMethodology();
    fetchPriorityInsights();
    checkMicrosoftConnection();
    fetchProfiles();
  }, []);

  async function fetchVoiceProfile() {
    setVoiceLoading(true);
    try {
      const res = await fetch('/api/ai/voice-profile');
      if (res.ok) {
        const data = await res.json();
        if (data.profile) {
          setVoiceProfile(data.profile);
        }
      }
    } catch (err) {
      console.error('Failed to fetch voice profile:', err);
    } finally {
      setVoiceLoading(false);
    }
  }

  async function generateVoiceProfile() {
    setVoiceGenerating(true);
    setVoiceError(null);
    try {
      const res = await fetch('/api/ai/voice-profile', {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error('Failed to generate voice profile');
      }
      const data = await res.json();
      setVoiceProfile(data.profile);
    } catch (err) {
      console.error('Voice profile generation failed:', err);
      setVoiceError('Failed to generate voice profile. Please try again.');
    } finally {
      setVoiceGenerating(false);
    }
  }

  async function fetchMethodology() {
    setMethodologyLoading(true);
    try {
      const res = await fetch('/api/ai/methodology');
      if (res.ok) {
        const data = await res.json();
        if (data.methodology) {
          setMethodologyData({
            methodology: data.methodology,
            updated_at: data.updated_at,
          });
        }
      }
    } catch (err) {
      console.error('Failed to fetch methodology:', err);
    } finally {
      setMethodologyLoading(false);
    }
  }

  async function generateMethodology() {
    setMethodologyGenerating(true);
    setMethodologyError(null);
    try {
      const res = await fetch('/api/ai/methodology', {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error('Failed to extract methodology');
      }
      const data = await res.json();
      setMethodologyData({
        methodology: data.methodology,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Methodology extraction failed:', err);
      setMethodologyError('Failed to extract engagement methodology. Please try again.');
    } finally {
      setMethodologyGenerating(false);
    }
  }

  function toggleMethodologySection(key: string) {
    setMethodologyExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function fetchPriorityInsights() {
    try {
      const res = await fetch('/api/settings/priority-insights');
      if (res.ok) {
        const data = await res.json();
        setPriorityInsights(data);
      }
    } catch (err) {
      console.error('Failed to fetch priority insights:', err);
    }
  }

  async function runPriorityLearning() {
    setPriorityRunning(true);
    setPriorityError(null);
    try {
      const res = await fetch('/api/settings/learn-priorities', {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error('Failed to run priority learning');
      }
      const data = await res.json();
      setPriorityInsights(data);
    } catch (err) {
      console.error('Priority learning failed:', err);
      setPriorityError('Failed to run priority learning. Please try again.');
    } finally {
      setPriorityRunning(false);
    }
  }

  async function checkMicrosoftConnection() {
    setMsLoading(true);
    try {
      const res = await fetch('/api/auth/microsoft/status');
      if (res.ok) {
        const data = await res.json();
        setMsConnected(data.connected || false);
      }
    } catch {
      // Not connected or endpoint doesn't exist yet
      setMsConnected(false);
    } finally {
      setMsLoading(false);
    }
  }

  async function fetchProfiles() {
    setProfilesLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('josh_profile')
        .select('*');
      if (error) throw error;
      setProfiles(data || []);
    } catch (err) {
      console.error('Failed to fetch profiles:', err);
    } finally {
      setProfilesLoading(false);
    }
  }

  async function refreshProfile(profileType: string) {
    const config = PROFILE_CONFIG[profileType];
    if (!config?.refreshEndpoint) {
      toast.error('This profile is auto-updated by the system.');
      return;
    }
    setRefreshingProfile(profileType);
    try {
      const res = await fetch(config.refreshEndpoint, { method: config.refreshMethod });
      if (!res.ok) throw new Error('Failed to refresh profile');
      toast.success(`${config.label} refreshed successfully`);
      await fetchProfiles();
    } catch (err) {
      console.error(`Failed to refresh ${profileType}:`, err);
      toast.error(`Failed to refresh ${config.label}. Please try again.`);
    } finally {
      setRefreshingProfile(null);
    }
  }

  function toggleProfile(profileType: string) {
    setExpandedProfiles((prev) => ({ ...prev, [profileType]: !prev[profileType] }));
  }

  function renderJsonValue(value: unknown, depth = 0): React.ReactNode {
    if (value === null || value === undefined) return null;

    if (typeof value === 'string') {
      return <p className="text-sm text-foreground">{value}</p>;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return <span className="text-sm text-foreground font-mono">{String(value)}</span>;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-xs text-muted">Empty</span>;
      // If array of strings, show as bullet list
      if (value.every((v) => typeof v === 'string')) {
        return (
          <ul className="space-y-1">
            {value.map((item, i) => (
              <li key={i} className="text-sm text-foreground flex items-start gap-2">
                <span className="text-primary mt-0.5 flex-shrink-0">-</span>
                {item}
              </li>
            ))}
          </ul>
        );
      }
      // Array of objects
      return (
        <div className="space-y-2">
          {value.map((item, i) => (
            <div key={i} className="bg-card rounded-lg border border-border/30 p-3">
              {renderJsonValue(item, depth + 1)}
            </div>
          ))}
        </div>
      );
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      return (
        <div className={depth > 0 ? 'space-y-2' : 'space-y-3'}>
          {entries.map(([key, val]) => (
            <div key={key}>
              <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                {key.replace(/_/g, ' ')}
              </h4>
              {renderJsonValue(val, depth + 1)}
            </div>
          ))}
        </div>
      );
    }

    return <span className="text-sm text-foreground">{String(value)}</span>;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-2xl header-gradient-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary pulse-alive" />
            <h1 className="text-lg font-bold tracking-tight text-gradient">SETTINGS</h1>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-24">
        {/* Voice Profile Section */}
        <section className="premium-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2">
            <UserCircle className="w-5 h-5 text-primary" />
            <h2 className="section-title text-foreground">
              Voice Profile
            </h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            {/* Status */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted">
                {voiceLoading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading...
                  </span>
                ) : voiceProfile ? (
                  <span>
                    Last updated:{' '}
                    <span className="text-foreground font-medium">
                      {format(new Date(voiceProfile.updated_at), 'MMM d, yyyy h:mma')}
                    </span>
                  </span>
                ) : (
                  <span className="text-warning">Not generated yet</span>
                )}
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={generateVoiceProfile}
              disabled={voiceGenerating}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary/20 text-primary rounded-lg font-medium text-sm hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {voiceGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating Voice Profile...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  {voiceProfile ? 'Regenerate Voice Profile' : 'Generate Voice Profile'}
                </>
              )}
            </button>

            {voiceError && (
              <p className="text-sm text-danger flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {voiceError}
              </p>
            )}

            {/* Profile Details */}
            {voiceProfile && (
              <div className="space-y-3 bg-background rounded-lg p-4">
                {voiceProfile.tone && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                      Tone
                    </h4>
                    <p className="text-sm text-foreground">{voiceProfile.tone}</p>
                  </div>
                )}
                {voiceProfile.signature_phrases && voiceProfile.signature_phrases.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                      Signature Phrases
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {voiceProfile.signature_phrases.map((phrase, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary"
                        >
                          {phrase}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {voiceProfile.frameworks_used && voiceProfile.frameworks_used.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
                      Frameworks Used
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {voiceProfile.frameworks_used.map((fw, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-0.5 rounded-full bg-success/15 text-success"
                        >
                          {fw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Engagement Methodology Section */}
        <section className="premium-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <h2 className="section-title text-foreground">
              Engagement Methodology
            </h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            {/* Status */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted">
                {methodologyLoading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading...
                  </span>
                ) : methodologyData ? (
                  <span>
                    Last updated:{' '}
                    <span className="text-foreground font-medium">
                      {format(new Date(methodologyData.updated_at), 'MMM d, yyyy h:mma')}
                    </span>
                  </span>
                ) : (
                  <span className="text-warning">Not generated yet</span>
                )}
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={generateMethodology}
              disabled={methodologyGenerating}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary/20 text-primary rounded-lg font-medium text-sm hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {methodologyGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Extracting Methodology...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  {methodologyData ? 'Re-extract Methodology' : 'Extract Methodology'}
                </>
              )}
            </button>

            {methodologyError && (
              <p className="text-sm text-danger flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {methodologyError}
              </p>
            )}

            {/* Methodology Details */}
            {methodologyData?.methodology && (
              <div className="space-y-3">
                {/* Named Frameworks */}
                {methodologyData.methodology.named_frameworks &&
                  methodologyData.methodology.named_frameworks.length > 0 && (
                    <div className="bg-background rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleMethodologySection('frameworks')}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">
                          Named Frameworks ({methodologyData.methodology.named_frameworks.length})
                        </h4>
                        {methodologyExpanded.frameworks ? (
                          <ChevronDown className="w-4 h-4 text-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      {methodologyExpanded.frameworks && (
                        <div className="px-4 pb-4 space-y-3">
                          {methodologyData.methodology.named_frameworks.map((fw, i) => (
                            <div
                              key={i}
                              className="bg-card rounded-lg border border-border/30 p-3 space-y-2"
                            >
                              <p className="text-sm font-medium text-foreground">
                                {fw.framework_name}
                              </p>
                              <p className="text-xs text-muted">{fw.description}</p>
                              {fw.clients_used_with && fw.clients_used_with.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {fw.clients_used_with.map((client, j) => (
                                    <span
                                      key={j}
                                      className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary"
                                    >
                                      {client}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                {/* Signature Questions */}
                {methodologyData.methodology.signature_questions &&
                  methodologyData.methodology.signature_questions.length > 0 && (
                    <div className="bg-background rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleMethodologySection('questions')}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">
                          Signature Questions ({methodologyData.methodology.signature_questions.length})
                        </h4>
                        {methodologyExpanded.questions ? (
                          <ChevronDown className="w-4 h-4 text-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      {methodologyExpanded.questions && (
                        <div className="px-4 pb-4 space-y-3">
                          {methodologyData.methodology.signature_questions.map((q, i) => (
                            <div
                              key={i}
                              className="bg-card rounded-lg border border-border/30 p-3 space-y-1.5"
                            >
                              <p className="text-sm font-medium text-foreground italic">
                                &ldquo;{q.question_pattern}&rdquo;
                              </p>
                              <p className="text-xs text-muted">
                                <span className="font-semibold">Unlocks:</span> {q.what_it_unlocks}
                              </p>
                              {q.frequency && (
                                <p className="text-xs text-muted">
                                  <span className="font-semibold">Frequency:</span> {q.frequency}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                {/* Engagement Sequences */}
                {(() => {
                  const sequences =
                    methodologyData.methodology.engagement_sequences ||
                    methodologyData.methodology.coaching_sequences;
                  if (!sequences || sequences.length === 0) return null;
                  return (
                    <div className="bg-background rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleMethodologySection('sequences')}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">
                          Engagement Sequences ({sequences.length})
                        </h4>
                        {methodologyExpanded.sequences ? (
                          <ChevronDown className="w-4 h-4 text-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      {methodologyExpanded.sequences && (
                        <div className="px-4 pb-4 space-y-3">
                          {sequences.map((seq, i) => (
                            <div
                              key={i}
                              className="bg-card rounded-lg border border-border/30 p-3 space-y-2"
                            >
                              <p className="text-sm font-medium text-foreground">
                                {seq.sequence_name}
                              </p>
                              <p className="text-xs text-muted">{seq.description}</p>
                              {seq.steps && seq.steps.length > 0 && (
                                <ol className="list-decimal list-inside space-y-0.5">
                                  {seq.steps.map((step, j) => (
                                    <li key={j} className="text-xs text-foreground">
                                      {step}
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Intervention Patterns */}
                {methodologyData.methodology.intervention_patterns &&
                  methodologyData.methodology.intervention_patterns.length > 0 && (
                    <div className="bg-background rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleMethodologySection('interventions')}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">
                          Intervention Patterns ({methodologyData.methodology.intervention_patterns.length})
                        </h4>
                        {methodologyExpanded.interventions ? (
                          <ChevronDown className="w-4 h-4 text-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      {methodologyExpanded.interventions && (
                        <div className="px-4 pb-4 space-y-3">
                          {methodologyData.methodology.intervention_patterns.map((ip, i) => (
                            <div
                              key={i}
                              className="bg-card rounded-lg border border-border/30 p-3 space-y-1.5"
                            >
                              <p className="text-sm font-medium text-foreground">
                                {ip.situation}
                              </p>
                              <p className="text-xs text-muted">
                                <span className="font-semibold">Response:</span>{' '}
                                {ip.josh_response_pattern}
                              </p>
                              {ip.effectiveness_notes && (
                                <p className="text-xs text-muted">
                                  <span className="font-semibold">Effectiveness:</span>{' '}
                                  {ip.effectiveness_notes}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                {/* Metaphors & Analogies */}
                {methodologyData.methodology.metaphors_and_analogies &&
                  methodologyData.methodology.metaphors_and_analogies.length > 0 && (
                    <div className="bg-background rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleMethodologySection('metaphors')}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors"
                      >
                        <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">
                          Metaphors & Analogies ({methodologyData.methodology.metaphors_and_analogies.length})
                        </h4>
                        {methodologyExpanded.metaphors ? (
                          <ChevronDown className="w-4 h-4 text-muted" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted" />
                        )}
                      </button>
                      {methodologyExpanded.metaphors && (
                        <div className="px-4 pb-4 space-y-3">
                          {methodologyData.methodology.metaphors_and_analogies.map((m, i) => (
                            <div
                              key={i}
                              className="bg-card rounded-lg border border-border/30 p-3 space-y-1.5"
                            >
                              <p className="text-sm font-medium text-foreground">
                                {m.metaphor}
                              </p>
                              <p className="text-xs text-muted">{m.description}</p>
                              {m.when_deployed && (
                                <p className="text-xs text-muted">
                                  <span className="font-semibold">Used when:</span>{' '}
                                  {m.when_deployed}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
              </div>
            )}
          </div>
        </section>

        {/* Priority Learning Section */}
        <section className="premium-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <h2 className="section-title text-foreground">
              Priority Learning
            </h2>
          </div>
          <div className="px-5 py-4 space-y-4">
            {/* Status */}
            <div className="text-sm text-muted">
              {priorityInsights?.last_run ? (
                <span>
                  Last run:{' '}
                  <span className="text-foreground font-medium">
                    {format(new Date(priorityInsights.last_run), 'MMM d, yyyy h:mma')}
                  </span>
                </span>
              ) : (
                <span className="text-warning">No learning run yet</span>
              )}
            </div>

            {/* Run Button */}
            <button
              onClick={runPriorityLearning}
              disabled={priorityRunning}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary/20 text-primary rounded-lg font-medium text-sm hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {priorityRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Running Priority Learning...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4" />
                  Run Priority Learning
                </>
              )}
            </button>

            {priorityError && (
              <p className="text-sm text-danger flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {priorityError}
              </p>
            )}

            {/* Insights */}
            {priorityInsights?.insights && priorityInsights.insights.length > 0 && (
              <div className="bg-background rounded-lg p-4">
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Insights
                </h4>
                <ul className="space-y-1.5">
                  {priorityInsights.insights.map((insight, i) => (
                    <li
                      key={i}
                      className="text-sm text-foreground flex items-start gap-2"
                    >
                      <span className="text-primary mt-0.5 flex-shrink-0">-</span>
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Modifier Rules */}
            {priorityInsights?.modifier_rules && priorityInsights.modifier_rules.length > 0 && (
              <div className="bg-background rounded-lg p-4">
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Modifier Rules
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left text-xs font-semibold text-muted uppercase tracking-wider py-2 pr-4">
                          Rule
                        </th>
                        <th className="text-right text-xs font-semibold text-muted uppercase tracking-wider py-2">
                          Modifier
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {priorityInsights.modifier_rules.map((rule, i) => (
                        <tr key={i} className="border-b border-border/30">
                          <td className="py-2 pr-4 text-foreground">
                            {rule.rule}
                          </td>
                          <td className="py-2 text-right font-mono">
                            <span
                              className={
                                rule.modifier > 0
                                  ? 'text-success'
                                  : rule.modifier < 0
                                  ? 'text-danger'
                                  : 'text-muted'
                              }
                            >
                              {rule.modifier > 0 ? '+' : ''}
                              {rule.modifier}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Connected Services Section */}
        <section className="premium-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2">
            <Plug className="w-5 h-5 text-primary" />
            <h2 className="section-title text-foreground">
              Connected Services
            </h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            {/* Microsoft Outlook */}
            <div className="flex items-center justify-between bg-background rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-blue-400"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M7.88 12.04q0 .45-.11.87-.1.41-.33.74-.22.33-.58.52-.37.2-.87.2t-.85-.2q-.35-.21-.57-.55-.22-.33-.33-.75-.1-.42-.1-.86t.1-.87q.1-.43.34-.76.22-.34.59-.54.36-.2.87-.2t.86.2q.35.21.57.55.22.34.33.75.1.43.1.87zm-4.53 0q0-.82.24-1.49.24-.66.7-1.12.46-.47 1.12-.72.66-.26 1.5-.26.84 0 1.5.26.65.25 1.11.72.46.46.7 1.12.24.67.24 1.49 0 .81-.24 1.48-.24.66-.7 1.12-.46.46-1.12.71-.65.26-1.49.26-.84 0-1.5-.26-.66-.25-1.12-.71-.46-.46-.7-1.12-.24-.67-.24-1.48zm17.65 4.12v-8.6l-6.2 4.12v-4.12l-6.2 4.34V4.04H0v16h22.8v-.88z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Microsoft Outlook
                  </p>
                  <p className="text-xs text-muted">
                    {msLoading
                      ? 'Checking...'
                      : msConnected
                      ? 'Connected'
                      : 'Not connected'}
                  </p>
                </div>
              </div>
              <div>
                {msLoading ? (
                  <Loader2 className="w-4 h-4 text-muted animate-spin" />
                ) : msConnected ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-xs text-success">
                      <Check className="w-3.5 h-3.5" />
                      Connected
                    </span>
                    <button
                      className="text-xs text-danger hover:text-danger/80 transition-colors font-medium"
                      onClick={() => {
                        // Placeholder for disconnect
                        alert('Disconnect functionality coming soon.');
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <a
                    href="/api/auth/microsoft"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    Connect
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* AI Intelligence Section */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold tracking-tight text-gradient">AI INTELLIGENCE</h2>
          </div>

          {profilesLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-card/50 border border-border/50 rounded-xl p-5 animate-pulse"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 bg-primary/10 rounded-lg" />
                    <div className="h-4 w-40 bg-primary/10 rounded" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-primary/5 rounded" />
                    <div className="h-3 w-2/3 bg-primary/5 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(PROFILE_CONFIG).map(([type, config]) => {
                const profile = profiles.find((p) => p.profile_type === type);
                const IconComponent = config.icon;
                const isExpanded = expandedProfiles[type];
                const isRefreshing = refreshingProfile === type;

                return (
                  <div
                    key={type}
                    className="bg-card/50 border border-border/50 rounded-xl overflow-hidden"
                  >
                    <div className="px-5 py-4 flex items-center justify-between">
                      <button
                        onClick={() => profile && toggleProfile(type)}
                        className="flex items-center gap-3 flex-1 text-left"
                      >
                        <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                          <IconComponent className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-foreground">{config.label}</h3>
                          {profile ? (
                            <p className="text-xs text-muted">
                              Updated {format(new Date(profile.updated_at), 'MMM d, yyyy h:mma')}
                            </p>
                          ) : (
                            <p className="text-xs text-warning">Not yet generated</p>
                          )}
                        </div>
                        {profile && (
                          isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted flex-shrink-0" />
                          )
                        )}
                      </button>
                      {config.refreshEndpoint && (
                        <button
                          onClick={() => refreshProfile(type)}
                          disabled={isRefreshing}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 text-primary rounded-lg text-xs font-medium hover:bg-primary/30 transition-colors disabled:opacity-50 ml-3 flex-shrink-0"
                        >
                          {isRefreshing ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          {profile ? 'Refresh' : 'Generate'}
                        </button>
                      )}
                      {!config.refreshEndpoint && (
                        <span className="text-xs text-muted ml-3 flex-shrink-0">Auto-updated</span>
                      )}
                    </div>
                    {profile && isExpanded && (
                      <div className="px-5 pb-4">
                        <div className="bg-background rounded-lg p-4">
                          {renderJsonValue(profile.data)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
