import { forwardRef } from 'react';

/**
 * AmbientRing — full-bleed ambient feedback layer.
 *
 * Tier mapping (matches backend HMIState.ring_color):
 *   Tier 0  -> faint emerald glow (invisible to inattentive driver)
 *   Tier 1  -> amber glow ring + haptic-flagged badge
 *   Tier 2  -> red pulsing ring + audio chime (one-shot per escalation)
 *
 * Performance:
 *  - Subscribes only to { tier, ringColor, message } from the store,
 *    so unrelated telemetry updates do not re-render this component.
 *  - All animations live in Framer Motion's rAF pipeline; the
 *    underlying motion.div mutates only transform / box-shadow / opacity.
 *  - No layout reads, no expensive filters, no per-frame React state.
 */

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTelemetryStore } from '../state/store.js';

const TIER_VARIANTS = {
  0: {
    ringOpacity: 0.18,
    ringColor: 'rgba(16, 185, 129, 0.55)',   // faint green
    glow: '0 0 60px 0 rgba(16, 185, 129, 0.15)',
    scale: 1.0,
    pulse: false,
  },
  1: {
    ringOpacity: 0.55,
    ringColor: 'rgba(245, 158, 11, 0.85)',   // amber
    glow: '0 0 120px 12px rgba(245, 158, 11, 0.45)',
    scale: 1.02,
    pulse: false,
  },
  2: {
    ringOpacity: 0.95,
    ringColor: 'rgba(239, 68, 68, 1.0)',     // red
    glow: '0 0 180px 24px rgba(239, 68, 68, 0.75)',
    scale: 1.05,
    pulse: true,
  },
};

const TRANSITION = { type: 'spring', stiffness: 110, damping: 18, mass: 0.6 };

const AmbientRing = forwardRef(function AmbientRing({ contained = false }, ref) {
  // Tight selector: only re-render on tier / color / message changes.
  const tier = useTelemetryStore((s) => s.latest?.tier ?? 0);
  const ringColor = useTelemetryStore((s) => s.latest?.ring_color ?? 'green');
  const message = useTelemetryStore((s) => s.latest?.message ?? 'Standby');
  const audioEnabled = useTelemetryStore((s) => s.audioEnabled);
  const audio = useTelemetryStore((s) => s.latest?.audio ?? false);

  const chimeRef = useRef(null);
  const lastTierRef = useRef(0);

  // Lazy-create a single AudioContext for the lifetime of the component.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && !chimeRef.current) {
      chimeRef.current = new AudioCtx();
    }
  }, []);

  // One-shot chime on Tier 2 *entry* (not on every red frame).
  useEffect(() => {
    if (!audio || !audioEnabled) return;
    if (lastTierRef.current === 2) return; // already in Tier 2
    lastTierRef.current = tier;
    if (tier !== 2) return;
    playChime(chimeRef.current);
  }, [tier, audio, audioEnabled]);

  const variant = TIER_VARIANTS[tier] ?? TIER_VARIANTS[0];

  const containerClass = contained
    ? "relative w-full h-full flex items-center justify-center"
    : "pointer-events-none fixed inset-0 z-0 flex items-center justify-center";
  const ringSize = contained ? "h-[28vmin] w-[28vmin]" : "h-[78vmin] w-[78vmin]";
  const readoutOffset = contained ? "mt-[10vmin]" : "mt-[34vmin]";

  return (
    <div className={containerClass}>
      {/* Outer ambient glow layer */}
      <motion.div
        className="absolute inset-0"
        animate={{
          background: `radial-gradient(ellipse at center, ${variant.ringColor} 0%, transparent 65%)`,
          opacity: variant.ringOpacity,
        }}
        transition={TRANSITION}
      />

      {/* Ring border layer (pulsing on Tier 2) */}
      <motion.div
        className={`relative ${ringSize} rounded-full border`}
        animate={{
          borderColor: variant.ringColor,
          boxShadow: variant.glow,
          scale: variant.scale,
        }}
        transition={TRANSITION}
      >
        <AnimatePresence>
          {variant.pulse && (
            <motion.div
              key="pulse"
              className="absolute inset-0 rounded-full"
              style={{ border: '2px solid rgba(239, 68, 68, 0.6)' }}
              initial={{ opacity: 0.9, scale: 0.96 }}
              animate={{ opacity: [0.9, 0.0, 0.9], scale: [0.96, 1.06, 0.96] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </AnimatePresence>
      </motion.div>

      {/* Center readout */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${tier}-${message}`}
          className={`absolute ${readoutOffset} flex flex-col items-center gap-2`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <span
            className="font-mono text-xs uppercase tracking-[0.4em]"
            style={{ color: variant.ringColor }}
          >
            Tier {tier}
          </span>
          <span className="text-lg font-medium text-slate-100">{message}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
});

export default AmbientRing;

// ---------------------------------------------------------------------------
// Audio chime — a soft 880Hz/660Hz two-tone blip, ~180ms total.
// ---------------------------------------------------------------------------
function playChime(ctx) {
  if (!ctx) return;
  const now = ctx.currentTime;
  const blip = (freq, startOffset, dur) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + startOffset);
    gain.gain.exponentialRampToValueAtTime(0.18, now + startOffset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + startOffset);
    osc.stop(now + startOffset + dur + 0.02);
  };
  blip(880, 0.0, 0.10);
  blip(660, 0.12, 0.10);
}
