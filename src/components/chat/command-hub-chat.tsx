'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, MessageSquare, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CommandHubChatProps {
  isOpen: boolean;
  onClose: () => void;
}

const SUGGESTED_PROMPTS = [
  "What's my week look like?",
  "What am I forgetting?",
  "What should I do next?",
  "Summarize my last session with...",
];

function formatMessage(content: string) {
  // Split into lines
  const lines = content.split('\n');
  return lines.map((line, i) => {
    // Bold text
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const formatted = parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={j} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });

    // Bullet points
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      return (
        <div key={i} className="flex gap-1.5 ml-2">
          <span className="text-muted flex-shrink-0">&#8226;</span>
          <span>{formatted.map((f) => (typeof f === 'string' ? f.replace(/^[-*]\s/, '') : f))}</span>
        </div>
      );
    }

    // Numbered lists
    if (/^\d+[.)]\s/.test(line.trim())) {
      return (
        <div key={i} className="ml-2">
          {formatted}
        </div>
      );
    }

    // Empty lines become spacing
    if (line.trim() === '') {
      return <div key={i} className="h-2" />;
    }

    return <div key={i}>{formatted}</div>;
  });
}

export function CommandHubChat({ isOpen, onClose }: CommandHubChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  async function sendMessage(text?: string) {
    const content = text || input.trim();
    if (!content || loading) return;

    const userMessage: ChatMessage = { role: 'user', content };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          history: messages,
        }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      const data = await res.json();
      setMessages([...updatedMessages, { role: 'assistant', content: data.response }]);
    } catch (err) {
      console.error('Chat error:', err);
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
          'fixed z-50 bg-background border border-border flex flex-col',
          // Mobile: slide up from bottom
          'bottom-0 left-0 right-0 h-[70vh] rounded-t-2xl',
          // Desktop: right sidebar
          'lg:top-0 lg:right-0 lg:left-auto lg:bottom-0 lg:h-full lg:w-[400px] lg:rounded-t-none lg:rounded-l-2xl'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-sm font-bold tracking-tight">Ask Command Hub</h2>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground transition-colors p-1 rounded-md hover:bg-card"
          >
            <X className="w-5 h-5" />
          </button>
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
                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                msg.role === 'user'
                  ? 'ml-auto bg-primary/20 text-foreground'
                  : 'mr-auto bg-card text-foreground'
              )}
            >
              {msg.role === 'assistant' ? (
                <div className="leading-relaxed">{formatMessage(msg.content)}</div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          ))}

          {loading && (
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
