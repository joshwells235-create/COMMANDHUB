'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, MessageSquare, Loader2, Copy, Check, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActionTaken {
  type: string;
  success: boolean;
  details: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  actions?: ActionTaken[];
}

interface CommandHubChatProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'commandhub-chat-history';
const MAX_STORED_MESSAGES = 50;

const SUGGESTED_PROMPTS = [
  "What should I do next?",
  "Who needs my attention?",
  "How are things going at...",
  "Prep me for my next meeting",
  "What am I forgetting?",
  "What happened this week?",
];

// --------------------------------------------------------------------------
// Markdown renderer — supports bold, italic, headers, code blocks, links,
// bullet/numbered lists, horizontal rules
// --------------------------------------------------------------------------
function formatMessage(content: string) {
  const lines = content.split('\n');
  const elements: React.JSX.Element[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={elements.length} className="bg-background rounded-lg p-3 my-1.5 overflow-x-auto text-xs font-mono border border-border">
          {lang && <div className="text-[10px] text-muted uppercase mb-1">{lang}</div>}
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={elements.length} className="border-border my-2" />);
      i++;
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = headerMatch[2];
      const cls = level === 1 ? 'text-base font-bold mt-2 mb-1' : level === 2 ? 'text-sm font-semibold mt-1.5 mb-0.5' : 'text-sm font-medium mt-1';
      elements.push(<div key={elements.length} className={cls}>{renderInline(text)}</div>);
      i++;
      continue;
    }

    // Empty lines
    if (line.trim() === '') {
      elements.push(<div key={elements.length} className="h-1.5" />);
      i++;
      continue;
    }

    // Bullet points
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      elements.push(
        <div key={elements.length} className="flex gap-1.5 ml-2">
          <span className="text-muted flex-shrink-0 mt-0.5">&#8226;</span>
          <span>{renderInline(line.trim().slice(2))}</span>
        </div>
      );
      i++;
      continue;
    }

    // Numbered lists
    if (/^\d+[.)]\s/.test(line.trim())) {
      elements.push(
        <div key={elements.length} className="ml-2">{renderInline(line.trim())}</div>
      );
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(<div key={elements.length}>{renderInline(line)}</div>);
    i++;
  }

  return elements;
}

function renderInline(text: string): (string | React.JSX.Element)[] {
  // Process: bold, italic, inline code, links
  const parts: (string | React.JSX.Element)[] = [];
  // Pattern: **bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[1];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={key++} className="font-semibold">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={key++} className="italic">{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={key++} className="bg-background px-1 py-0.5 rounded text-xs font-mono text-primary">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        parts.push(
          <a key={key++} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">
            {linkMatch[1]}
          </a>
        );
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

// --------------------------------------------------------------------------
// Copy button for assistant messages
// --------------------------------------------------------------------------
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 p-1 rounded bg-background/80 border border-border text-muted hover:text-foreground transition-all"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

// --------------------------------------------------------------------------
// Main component
// --------------------------------------------------------------------------
export function CommandHubChat({ isOpen, onClose }: CommandHubChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ChatMessage[];
        setMessages(parsed.slice(-MAX_STORED_MESSAGES));
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // Save history to localStorage on change
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
      } catch {
        // ignore storage errors
      }
    }
  }, [messages]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  function clearHistory() {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  }

  async function sendMessage(text?: string) {
    const content = text || input.trim();
    if (!content || loading) return;

    const userMessage: ChatMessage = { role: 'user', content };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);
    setStreamingContent('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          history: messages.slice(-20), // Send last 20 messages as context (not unlimited)
        }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      // Check if streaming response
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
        // Stream the response
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            fullContent += chunk;
            setStreamingContent(fullContent);
          }
        }

        setStreamingContent('');
        setMessages([...updatedMessages, { role: 'assistant', content: fullContent }]);
      } else {
        // JSON response (action-based)
        const data = await res.json();
        setMessages([...updatedMessages, {
          role: 'assistant',
          content: data.message || data.response,
          actions: data.actions_taken,
        }]);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setStreamingContent('');
      setMessages([
        ...updatedMessages,
        { role: 'assistant', content: 'Sorry, I ran into an error. Try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 lg:bg-transparent lg:pointer-events-none"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          'fixed z-50 chat-glass border border-border flex flex-col',
          'bottom-0 left-0 right-0 h-[70vh] rounded-t-2xl',
          'lg:top-0 lg:right-0 lg:left-auto lg:bottom-0 lg:h-full lg:w-[400px] lg:rounded-t-none lg:rounded-l-2xl'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0 header-gradient-border" style={{ background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.06), rgba(129, 140, 248, 0.03))' }}>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-sm font-bold tracking-tight text-gradient">Ask Command Hub</h2>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-muted hover:text-foreground transition-colors p-1 rounded-md hover:bg-card"
                title="Clear chat history"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-muted hover:text-foreground transition-colors p-1 rounded-md hover:bg-card"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <div className="text-center">
                <MessageSquare className="w-8 h-8 text-muted/40 mx-auto mb-2" />
                <p className="text-sm text-muted">What do you need?</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-xs">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="text-xs px-3 py-1.5 bg-card hover:bg-card-hover border border-border rounded-full text-foreground transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm relative',
                msg.role === 'user'
                  ? 'ml-auto text-foreground border border-primary/20 bg-primary/15'
                  : 'mr-auto glass text-foreground group'
              )}
            >
              {msg.role === 'assistant' ? (
                <>
                  <CopyButton text={msg.content} />
                  <div className="leading-relaxed">
                    {formatMessage(msg.content)}
                    {msg.actions && msg.actions.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                        {msg.actions.map((action, j) => (
                          <div
                            key={j}
                            className={cn(
                              'flex items-center gap-1.5 text-xs px-2 py-1 rounded',
                              action.success
                                ? 'bg-green-500/10 text-green-400'
                                : 'bg-red-500/10 text-red-400'
                            )}
                          >
                            <span>{action.success ? '✓' : '✗'}</span>
                            <span>{action.details}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          ))}

          {/* Streaming content */}
          {streamingContent && (
            <div className="max-w-[85%] mr-auto glass text-foreground rounded-xl px-3.5 py-2.5 text-sm">
              <div className="leading-relaxed">
                {formatMessage(streamingContent)}
              </div>
            </div>
          )}

          {loading && !streamingContent && (
            <div className="mr-auto bg-card rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="px-4 py-3 border-t border-border flex-shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What do you need?"
              disabled={loading}
              rows={1}
              className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary resize-none max-h-24 disabled:opacity-50"
              style={{ minHeight: '38px' }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="flex-shrink-0 p-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
