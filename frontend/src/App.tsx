import { useState, useEffect, useRef } from 'react';
import { Rocket, Bot, RefreshCw, Undo, Activity, CheckCircle, AlertTriangle, Info, ShieldCheck, ExternalLink, Server, Cpu, HardDrive } from 'lucide-react';
import ChatWidget from './ChatWidget';

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
  const [legend, setLegend] = useState<{color: string, label: string}[]>([]);

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
      const newLegend: {color: string, label: string}[] = [];
      
      series.forEach((s, si) => {
        const color = colors[si % colors.length];
        newLegend.push({ color, label: `${s.metric.method || 'GET'} ${s.metric.route || '/'} (${s.metric.status || '200'})` });
        
        const pts = s.values.map(([t, v]) => ({
          x: pad.left + ((t - minT) / (maxT - minT || 1)) * (W - pad.left - pad.right),
          y: pad.top + (1 - parseFloat(v) / maxV) * (H - pad.top - pad.bottom)
        }));
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 6;
        ctx.shadowColor = color;
        ctx.beginPath();
        pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      setStatus('ok');
      setLabel(`${series.length} series · ${allPoints.length} data points`);
      setLegend(newLegend);
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
      
      {legend.length > 0 && (
        <div style={{ background: 'rgba(22,27,34,0.6)', padding: '16px', borderRadius: '6px', border: '1px solid rgba(48,54,61,0.5)', marginTop: '4px' }}>
          <ul style={{ fontSize: '0.75rem', color: '#8b949e', margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li><span style={{color: '#58a6ff', fontWeight: 'bold'}}>GET /api/deployments (Blue):</span> Background dashboard traffic constantly polling the server to update UI state.</li>
            <li><span style={{color: '#3fb950', fontWeight: 'bold'}}>POST /webhook/github (Green):</span> Deployment Automation. Spikes the exact moment a developer pushes code, triggering AI review.</li>
            <li><span style={{color: '#a371f7', fontWeight: 'bold'}}>POST /.../rollback (Purple):</span> Version Control Tracker. Shows when automated or manual rollback sequences are executed to restore stable state.</li>
            <li><span style={{color: '#ff7b72', fontWeight: 'bold'}}>Any 5xx Status (Red):</span> System Alerts. Tracks active server crashes, unhandled exceptions, and infrastructure failures in the containers.</li>
          </ul>
        </div>
      )}

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
        <h1>
          <img src="/vulcan-logo.png" alt="Vulcan Logo" style={{ width: 64, height: 64, borderRadius: '50%', boxShadow: '0 0 24px rgba(163, 113, 247, 0.6)', objectFit: 'cover', transition: 'all 0.3s ease' }} onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.removeAttribute('style'); }} />
          <Rocket color="#a371f7" size={32} style={{ display: 'none' }} /> VulcanPaaS
        </h1>
        <span style={{ fontSize: '0.85rem', color: '#d2a8ff', background: 'rgba(163, 113, 247, 0.1)', padding: '6px 12px', borderRadius: '12px', border: '1px solid rgba(163, 113, 247, 0.2)' }}>Push → Deepseek V3 Review → Auto-Deploy</span>
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

      <MockServerMetrics />
      <ChatWidget />
    </div>
  );
}

function MockServerMetrics() {
  const [cpu, setCpu] = useState(15);
  const [ram, setRam] = useState(4.2);
  const [net, setNet] = useState(85);

  useEffect(() => {
    const interval = setInterval(() => {
      // Fluctuates between 10-20% for CPU
      setCpu(Math.floor(Math.random() * 11) + 10);
      // Fluctuates slightly around 4GB for RAM
      setRam(+(4.0 + Math.random() * 0.5).toFixed(1));
      // Network ping 40-80ms
      setNet(Math.floor(Math.random() * 40) + 40);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="card metrics-footer">
      <div className="card-header">
        <Server size={20} color="#a371f7" />
        <h2>Live Server Metrics (Local Node Simulator)</h2>
      </div>
      <div className="metrics-row">
        <div className="metric-box">
          <Cpu size={24} color="#58a6ff" />
          <div className="metric-value">{cpu}%</div>
          <div className="metric-label">CPU Usage</div>
        </div>
        <div className="metric-box">
          <HardDrive size={24} color="#3fb950" />
          <div className="metric-value">{ram} GB</div>
          <div className="metric-label">RAM (16GB Total)</div>
        </div>
        <div className="metric-box">
          <Activity size={24} color="#ff7b72" />
          <div className="metric-value">{net} ms</div>
          <div className="metric-label">Network Latency</div>
        </div>
        <div className="metric-box">
          <Server size={24} color="#d2a8ff" />
          <div className="metric-value">99.99%</div>
          <div className="metric-label">Uptime</div>
        </div>
      </div>
    </div>
  );
}
