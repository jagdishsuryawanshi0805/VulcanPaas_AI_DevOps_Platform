import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Bot, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './ChatWidget.css';

interface ChatMessage {
  role: 'user' | 'bot';
  content: string;
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem('vulcanbot_chat');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [{ role: 'bot', content: 'Hello! I am VulcanBot. Ask me about your deployments, metrics, or AI code reviews.' }];
      }
    }
    return [{ role: 'bot', content: 'Hello! I am VulcanBot. Ask me about your deployments, metrics, or AI code reviews.' }];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
    localStorage.setItem('vulcanbot_chat', JSON.stringify(messages));
  }, [messages]);

  const clearChat = () => {
    setMessages([{ role: 'bot', content: 'Hello! I am VulcanBot. Chat history cleared. How can I help you today?' }]);
    localStorage.removeItem('vulcanbot_chat');
  };

  const sendMessage = async (overrideText?: string) => {
    const userMsg = overrideText || input.trim();
    if (!userMsg) return;
    if (!overrideText) setInput('');
    
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'bot', content: data.reply || data.error }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'bot', content: 'Connection error' }]);
    }
    setLoading(false);
  };

  return (
    <>
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button className="chat-toggle" onClick={() => setIsOpen(true)}>
          <MessageCircle size={28} color="#fff" />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="chat-window fade-in">
          <div className="chat-header">
            <div className="chat-header-title">
              <Bot size={20} color="#a371f7" />
              <span>VulcanBot Assistant</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="chat-close" onClick={clearChat} title="Clear Chat">
                <Trash2 size={16} color="#8b949e" />
              </button>
              <button className="chat-close" onClick={() => setIsOpen(false)} title="Close Chat">
                <X size={20} color="#8b949e" />
              </button>
            </div>
          </div>

          <div className="chat-body">
            {messages.map((msg, i) => (
              <div key={i} className={`chat-bubble ${msg.role}`}>
                {msg.role === 'bot' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
            ))}
            {loading && (
              <div className="chat-bubble bot typing">
                <span></span><span></span><span></span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-suggestions" style={{ display: 'flex', gap: '8px', padding: '0 12px 12px', overflowX: 'auto', whiteSpace: 'nowrap', borderTop: '1px solid rgba(163, 113, 247, 0.1)', paddingTop: '12px' }}>
            {["List active apps", "System metrics", "Recent deployments", "Code reviews", "Vulcan features"].map(s => (
              <button 
                key={s} 
                onClick={() => sendMessage(s)}
                style={{ background: 'rgba(163, 113, 247, 0.15)', border: '1px solid rgba(163,113,247,0.4)', color: '#d2a8ff', padding: '6px 12px', borderRadius: '16px', fontSize: '0.75rem', cursor: 'pointer', flexShrink: 0, transition: 'background 0.2s' }}
                onMouseOver={e => e.currentTarget.style.background = 'rgba(163, 113, 247, 0.3)'}
                onMouseOut={e => e.currentTarget.style.background = 'rgba(163, 113, 247, 0.15)'}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="chat-footer">
            <input 
              type="text" 
              placeholder="Ask about your infrastructure..." 
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
            />
            <button className="chat-send" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
