import { useState, useEffect, useRef } from 'react';
import { Rocket, Bot, RefreshCw, Undo, Activity, CheckCircle, AlertTriangle, Info, ShieldCheck, ExternalLink } from 'lucide-react';

interface Deployment {
  id: string;
  commitHash: string;
  message: string;
  status: 'active' | 'failed' | 'deploying';
  date: string;
  review?: string;
}

interface MetricPoint { time: number; value: number; }
interface MetricSeries { metric: Record<string, string>; values: [number, string][]; }

// --- AI Review Renderer ---
function ReviewCard({ review }: { review: string }) {
  const lines = review.split('\n').filter(Boolean);
  return (
    <div className="review-card">
      <div className="review-header">
        <Bot size={14} color="#a371f7" />
        <span>Deepseek V3 Code Review</span>
      </div>
      <div className="review-body">
        {lines.map((line, i) => {
          if (line.startsWith('###')) return <div key={i} className="review-title">{line.replace(/^###\s*🤖\s*/, '')}</div>;
          if (line.startsWith('**Commit')) return <div key={i} className="review-label">{line.replace(/\*\*/g, '')}</div>;
          if (line.startsWith('**Verdict')) return <div key={i} className="review-verdict"><ShieldCheck size={13}/><span>{line.replace(/\*\*/g, '')}</span></div>;
          if (line.startsWith('✅')) return <div key={i} className="review-pass"><CheckCircle size={13}/><span>{line.replace(/^✅\s*/, '')}</span></div>;
          if (line.startsWith('⚠️')) return <div key={i} className="review-warn"><AlertTriangle size={13}/><span>{line.replace(/^⚠️\s*/, '')}</span></div>;
          if (line.startsWith('ℹ️')) return <div key={i} className="review-info"><Info size={13}/><span>{line.replace(/^ℹ️\s*/, '')}</span></div>;
          return <div key={i} className="review-text">{line}</div>;
        })}
      </div>
    </div>
  );
}

// --- Prometheus Chart ---
function PrometheusChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [label, setLabel] = useState('Fetching metrics...');

  const fetchAndDraw = async () => {
    try {
      const res = await fetch(`/api/metrics-data`);
      const json = await res.json();
      const series: MetricSeries[] = json.data?.result ?? [];

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      if (series.length === 0) {
        ctx.fillStyle = '#8b949e';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No data yet – trigger a webhook to generate traffic', W / 2, H / 2);
        setStatus('ok');
        setLabel('Waiting for API traffic data...');
        return;
      }

      // Parse all points
      const allPoints: MetricPoint[] = series.flatMap(s => s.values.map(([t, v]) => ({ time: t, value: parseFloat(v) })));
      const minT = Math.min(...allPoints.map(p => p.time));
      const maxT = Math.max(...allPoints.map(p => p.time));
      const maxV = Math.max(...allPoints.map(p => p.value), 0.01);
      const pad = { top: 20, right: 20, bottom: 30, left: 45 };

      // Grid lines
      ctx.strokeStyle = 'rgba(48,54,61,0.6)';
      ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) {
        const y = pad.top + (H - pad.top - pad.bottom) * (1 - g / 4);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        ctx.fillStyle = '#8b949e';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText((maxV * g / 4).toFixed(3), pad.left - 6, y + 3);
      }

      // Plot each series
      const colors = ['#58a6ff', '#3fb950', '#a371f7', '#ff7b72'];
      series.forEach((s, si) => {
        const pts = s.values.map(([t, v]) => ({
          x: pad.left + ((t - minT) / (maxT - minT || 1)) * (W - pad.left - pad.right),
          y: pad.top + (1 - parseFloat(v) / maxV) * (H - pad.top - pad.bottom)
        }));
        ctx.strokeStyle = colors[si % colors.length];
        ctx.lineWidth = 2;
        ctx.shadowBlur = 6;
        ctx.shadowColor = colors[si % colors.length];
        ctx.beginPath();
        pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      setStatus('ok');
      setLabel(`${series.length} series · ${allPoints.length} data points`);
    } catch {
      setStatus('error');
      setLabel('Could not reach Prometheus. Is it running?');
    }
  };

  useEffect(() => {
    fetchAndDraw();
    const t = setInterval(fetchAndDraw, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <canvas ref={canvasRef} width={580} height={240}
        style={{ width: '100%', height: 'auto', borderRadius: '8px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(48,54,61,0.8)' }} />
      <p style={{ fontSize: '0.75rem', color: status === 'error' ? '#ff7b72' : '#8b949e' }}>{label}</p>
    </div>
  );
}

// --- Main App ---
export default function App() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/deployments');
        const data = await res.json();
        if (Array.isArray(data)) setDeployments(data);
      } catch {}
    };
    fetch_();
    const t = setInterval(fetch_, 3000);
    return () => clearInterval(t);
  }, []);

  const handleRollback = async (id: string) => {
    await fetch(`/api/deployments/${id}/rollback`, { method: 'POST' });
  };

  return (
    <div className="container">
      <header>
        <h1><Rocket color="#58a6ff" size={32} /> VulcanPaaS</h1>
        <span style={{ fontSize: '0.875rem', color: '#8b949e' }}>Push → Deepseek V3 Review → Auto-Deploy</span>
      </header>

      <div className="grid">
        {/* Deployments Panel */}
        <div className="card">
          <div className="card-header">
            <RefreshCw size={20} color="#3fb950" />
            <h2>Deployments & AI Reviews</h2>
          </div>
          <div className="list">
            {deployments.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center' }}>
                <Bot size={40} color="#8b949e" style={{ marginBottom: '1rem', display: 'block', margin: '0 auto 1rem' }} />
                <p style={{ color: '#8b949e', marginBottom: '1rem' }}>No deployments yet. Trigger with:</p>
                <code style={{ fontSize: '0.7rem', background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: '6px', display: 'block', textAlign: 'left', border: '1px solid rgba(88,166,255,0.2)', color: '#58a6ff', lineHeight: 1.8 }}>
                  curl -X POST -H "Content-Type: application/json" \<br/>
                  -d '&#123;"commits":[&#123;"id":"abc123","message":"My feature"&#125;]&#125;' \<br/>
                  http://localhost/api/webhook/github
                </code>
              </div>
            ) : deployments.map(dep => (
              <div key={dep.id} className="list-item">
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                    <h3 style={{ fontFamily: 'monospace', fontSize: '1rem' }}>{dep.commitHash}</h3>
                    <span className={`badge ${dep.status}`}>
                      {dep.status === 'deploying' && <span className="loader" style={{ marginRight: 4 }} />}
                      {dep.status}
                    </span>
                  </div>
                  <p style={{ fontWeight: 500, marginBottom: '4px' }}>{dep.message}</p>
                  <p style={{ fontSize: '0.75rem', color: '#8b949e', marginBottom: '10px' }}>{new Date(dep.date).toLocaleString()}</p>
                  {dep.review && <ReviewCard review={dep.review} />}
                  {dep.status === 'failed' && (
                    <button className="primary" style={{ marginTop: '12px' }} onClick={() => handleRollback(dep.id)}>
                      <Undo size={14} /> Rollback to This
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Metrics Panel */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="card-header">
            <Activity size={20} color="#ff7b72" />
            <h2>Live Metrics — API Request Rate</h2>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#8b949e', marginTop: '-0.5rem' }}>
            Live data from Prometheus — refreshes every 10s
          </p>
          <PrometheusChart />
          <a href="/grafana/" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            <button style={{ width: '100%', justifyContent: 'center' }}>
              <ExternalLink size={14} /> Open Full Grafana Dashboard
            </button>
          </a>
        </div>
      </div>
    </div>
  );
}
