import { useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AmbientRing from './components/AmbientRing.jsx';
import { useTelemetryStore } from './state/store.js';
import './App.css';

const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/telemetry`;
})();

export default function App() {
  const status = useTelemetryStore((s) => s.status);
  const setStatus = useTelemetryStore((s) => s.setStatus);
  const pushFrame = useTelemetryStore((s) => s.pushFrame);
  const latest = useTelemetryStore((s) => s.latest);
  const history = useTelemetryStore((s) => s.history);
  const profile = useTelemetryStore((s) => s.profile);
  const setProfile = useTelemetryStore((s) => s.setProfile);
  const audioEnabled = useTelemetryStore((s) => s.audioEnabled);
  const toggleAudio = useTelemetryStore((s) => s.toggleAudio);

  const wsRef = useRef(null);
  const reconnectRef = useRef({ attempts: 0, timer: null });

  useEffect(() => {
    let cancelled = false;
    const connect = () => {
      if (cancelled) return;
      setStatus('connecting');
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        reconnectRef.current.attempts = 0;
        setStatus('open');
      };
      ws.onmessage = (evt) => {
        try { pushFrame(JSON.parse(evt.data)); } catch {}
      };
      ws.onerror = () => setStatus('error');
      ws.onclose = () => {
        setStatus('closed');
        if (cancelled) return;
        const delay = Math.min(15_000, 500 * 2 ** reconnectRef.current.attempts);
        reconnectRef.current.attempts += 1;
        reconnectRef.current.timer = setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectRef.current.timer);
      wsRef.current?.close();
    };
  }, [setStatus, pushFrame]);

  return (
    <div className="h-full w-full bg-nivara-ink font-sans flex">
      {/* ── LEFT PANEL: Dashcam Placeholder (2/3) ── */}
      <div className="w-2/3 h-full p-5">
        <div className="relative h-full w-full rounded-3xl border border-slate-800/60 bg-gradient-to-b from-slate-900/60 to-slate-950/80 flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(16,185,129,0.03)_0%,_transparent_60%)]" />
          <div className="relative flex flex-col items-center gap-3">
            <svg className="h-10 w-10 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="text-xs font-mono tracking-[0.3em] text-slate-600 uppercase">
              Dashcam Video Feed Overlay
            </span>
            <span className="text-[10px] font-mono text-slate-700/60">
              Layer MP4 footage here during editing
            </span>
          </div>
          {/* Corner accents */}
          <div className="absolute top-4 left-4 h-8 w-8 border-t-2 border-l-2 border-emerald-500/20 rounded-tl" />
          <div className="absolute top-4 right-4 h-8 w-8 border-t-2 border-r-2 border-emerald-500/20 rounded-tr" />
          <div className="absolute bottom-4 left-4 h-8 w-8 border-b-2 border-l-2 border-emerald-500/20 rounded-bl" />
          <div className="absolute bottom-4 right-4 h-8 w-8 border-b-2 border-r-2 border-emerald-500/20 rounded-br" />
        </div>
      </div>

      {/* ── RIGHT PANEL: HUD Console (1/3) ── */}
            <div className="w-1/3 h-full flex flex-col gap-3 p-5 pl-0 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(16,185,129,0.6)]" />
            <h1 className="text-sm font-semibold tracking-[0.3em] text-slate-200">
              NIVĀRA
            </h1>
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-600">
              ADAS
            </span>
          </div>
          <StatusPill status={status} />
        </div>

        {/* Ambient Ring */}
        <div className="relative flex-shrink-0 h-[32vh] flex items-center justify-center">
          <AmbientRing contained />
        </div>

        {/* Telemetry Cards */}
        <TelemetryGrid latest={latest} />

        {/* Profile Toggle */}
        <ProfileControl profile={profile} setProfile={setProfile} />

        {/* Trip Log */}
        <TripLog history={history} />

        {/* Audio Toggle */}
        <div className="flex items-center justify-end flex-shrink-0 pb-2">
          <button
            type="button"
            onClick={toggleAudio}
            className={
              'rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-widest transition ' +
              (audioEnabled
                ? 'border-rose-400/60 bg-rose-400/10 text-rose-300'
                : 'border-slate-700 bg-slate-900/40 text-slate-500 hover:border-slate-500')
            }
          >
            {audioEnabled ? 'Audio: On' : 'Audio: Off'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function StatusPill({ status }) {
  const map = {
    idle:        { label: 'Standby',    color: 'bg-slate-500' },
    connecting:  { label: 'Connecting', color: 'bg-amber-400 animate-pulse' },
    open:        { label: 'Live',       color: 'bg-emerald-400' },
    closed:      { label: 'Offline',    color: 'bg-rose-500' },
    error:       { label: 'Error',      color: 'bg-rose-500' },
  };
  const cfg = map[status] ?? map.idle;
  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-slate-400">
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.color}`} />
      {cfg.label}
    </div>
  );
}

function TelemetryGrid({ latest }) {
  if (!latest) {
    return (
      <div className="rounded-2xl border border-slate-800/50 bg-slate-900/30 p-4 text-center text-[11px] font-mono text-slate-600">
        Awaiting telemetry…
      </div>
    );
  }
  const cards = [
    { label: 'Speed',     value: latest.speed?.toFixed(1),     unit: 'km/h' },
    { label: 'Brake',     value: latest.brake?.toFixed(1),     unit: 'bar' },
    { label: 'Lateral',   value: latest.lateral?.toFixed(2),   unit: 'm' },
    { label: 'Confidence', value: (latest.confidence * 100)?.toFixed(0), unit: '%' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 flex-shrink-0">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-slate-800/50 bg-slate-900/40 px-3 py-2.5">
          <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{c.label}</div>
          <div className="mt-0.5 flex items-baseline gap-1">
            <span className="text-lg font-semibold tracking-tight text-slate-100 tabular-nums">{c.value ?? '—'}</span>
            <span className="text-[10px] font-mono text-slate-600">{c.unit}</span>
          </div>
        </div>
      ))}
      {/* Tier badge — spans full width */}
      <div className="col-span-2 rounded-xl border border-slate-800/50 bg-slate-900/40 px-3 py-2.5 flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Tier</span>
        <span className={`text-sm font-bold font-mono tabular-nums ${
          latest.tier === 2 ? 'text-rose-400' : latest.tier === 1 ? 'text-amber-400' : 'text-emerald-400'
        }`}>
          {latest.tier}
        </span>
        <span className="text-[11px] font-medium text-slate-300 truncate ml-auto max-w-[50%] text-right">
          {latest.message}
        </span>
      </div>
    </div>
  );
}

function ProfileControl({ profile, setProfile }) {
  return (
    <div className="flex gap-2 flex-shrink-0">
      {['aggressive', 'cautious'].map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => setProfile(p)}
          className={
            'flex-1 rounded-full border py-1.5 text-[11px] font-medium uppercase tracking-widest transition ' +
            (profile === p
              ? 'border-emerald-400/60 bg-emerald-400/10 text-emerald-300'
              : 'border-slate-700 bg-slate-900/40 text-slate-500 hover:border-slate-500')
          }
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function TripLog({ history }) {
  const events = useMemo(() => {
    if (!history || history.length === 0) return [];
    const entries = [];
    let prevTier = -1;
    for (const f of history) {
      if (f.tier !== prevTier || f.suppressed) {
        entries.push({ ts: f.ts, tier: f.tier, msg: f.message, suppressed: f.suppressed });
        prevTier = f.tier;
      }
    }
    return entries.slice(-12).reverse();
  }, [history]);

  return (
    <div className="flex-1 min-h-0 rounded-2xl border border-slate-800/50 bg-slate-900/30 p-3 flex flex-col">
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600 mb-2 flex-shrink-0">
        Trip Log
      </div>
      <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin">
        {events.length === 0 && (
          <div className="text-[11px] font-mono text-slate-700 italic">No events yet</div>
        )}
        {events.map((e, i) => (
          <motion.div
            key={`${e.ts}-${i}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2 py-1 border-b border-slate-800/30 last:border-0"
          >
            <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
              e.tier === 2 ? 'bg-rose-500' : e.tier === 1 ? 'bg-amber-500' : 'bg-emerald-500'
            }`} />
            <span className={`text-[11px] font-mono font-medium ${
              e.tier === 2 ? 'text-rose-300' : e.tier === 1 ? 'text-amber-300' : 'text-slate-400'
            }`}>
              T{e.tier}
            </span>
            <span className="text-[11px] font-sans text-slate-400 truncate">{e.msg}</span>
            {e.suppressed && (
              <span className="ml-auto text-[9px] font-mono uppercase tracking-wider text-slate-600 bg-slate-800/40 rounded px-1.5 py-0.5 flex-shrink-0">
                suppressed
              </span>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
