/**
 * Nivāra telemetry store (Zustand).
 *
 * Design:
 *  - The WebSocket is owned by a single `useTelemetryStream` hook in App.jsx.
 *  - Incoming frames are buffered and committed to the store at most once
 *    per animation frame, so a 10Hz stream never triggers more than ~60
 *    React renders/sec (usually far fewer).
 *  - Components subscribe with selectors to avoid re-rendering the entire
 *    tree on each frame — AmbientRing only watches {tier, ringColor}.
 *
 * Public surface:
 *  - state: { status, latest, history, profile, audioEnabled, confidence }
 *  - actions: setStatus, pushFrame, setProfile, toggleAudio, setSuppressed
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const RING_BUFFER_SIZE = 240; // ~24s of telemetry at 10Hz

const initialState = () => ({
  status: 'idle',          // 'idle' | 'connecting' | 'open' | 'closed' | 'error'
  latest: null,            // most recent telemetry frame
  history: [],             // ring buffer of frames (for sparkline / debug)
  profile: 'aggressive',   // 'aggressive' | 'cautious'
  audioEnabled: false,
});

export const useTelemetryStore = create(
  persist(
    (set, get) => ({
      ...initialState(),

      setStatus: (status) => set({ status }),

      pushFrame: (frame) => enqueueFrame(frame),

      setProfile: async (profile) => {
        set({ profile });
        try {
          await fetch(`/profile/${profile}`, { method: 'POST' });
        } catch (err) {
          console.warn('[nivara] profile sync failed', err);
        }
      },

      toggleAudio: () => set((s) => ({ audioEnabled: !s.audioEnabled })),

      reset: () => set(initialState()),
    }),
    {
      name: 'nivara-storage',
      partialize: (state) => ({
        profile: state.profile,
        audioEnabled: state.audioEnabled,
      }),
    },
  ),
);

// ---------------------------------------------------------------------------
// Internal: rAF-coalesced frame writer
// ---------------------------------------------------------------------------

let _frameQueue = [];
let _rafHandle = null;
let _setRef = null; // captured `set` from the store

function _bindSet() {
  if (_setRef) return;
  _setRef = useTelemetryStore.setState;
}

function _flush() {
  _rafHandle = null;
  if (_frameQueue.length === 0) return;
  const frames = _frameQueue;
  _frameQueue = [];

  // Coalesce: keep the newest frame as `latest`, append tail to history.
  const newest = frames[frames.length - 1];
  _setRef((state) => {
    const merged = state.history.concat(frames);
    const trimmed =
      merged.length > RING_BUFFER_SIZE
        ? merged.slice(merged.length - RING_BUFFER_SIZE)
        : merged;
    return { latest: newest, history: trimmed };
  });
}

function enqueueFrame(frame) {
  _bindSet();
  _frameQueue.push(frame);
  if (_rafHandle == null) {
    _rafHandle = requestAnimationFrame(_flush);
  }
}
