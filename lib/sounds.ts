let _ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!_ctx) _ctx = new AC();
    if (_ctx.state === "suspended") void _ctx.resume();
    return _ctx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  endFreq: number,
  duration: number,
  volume: number,
  delay = 0,
  type: OscillatorType = "sine",
): void {
  const c = getCtx();
  if (!c) return;
  try {
    const t    = c.currentTime + delay;
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq)
      osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  } catch { /* AudioContext might not be available */ }
}

/** Quick electronic blip — navigation tap */
export function playNavTap(): void {
  tone(1300, 840, 0.038, 0.07);
}

/** Soft descending sweep — page transition */
export function playPageTransition(): void {
  tone(660, 330, 0.095, 0.045);
}

/** Cascading power-down — sign out */
export function playSignOut(): void {
  tone(520, 260, 0.12, 0.055, 0.00);
  tone(260, 130, 0.12, 0.045, 0.11);
  tone(130,  52, 0.22, 0.035, 0.21);
}

/** Ascending boot chime — dashboard first mount */
export function playBoot(): void {
  [220, 380, 560, 880].forEach((f, i) =>
    tone(f, f * 1.38, 0.07, 0.030, i * 0.078),
  );
}

/** Triumphant fanfare — new personal record */
export function playPR(): void {
  tone(523, 523, 0.10, 0.06, 0.00);
  tone(659, 659, 0.10, 0.07, 0.10);
  tone(784, 1046, 0.25, 0.08, 0.20);
}

/** Double chime — rest timer finished, time for the next set */
export function playRestComplete(): void {
  tone(880, 880, 0.12, 0.07, 0.00);
  tone(880, 880, 0.12, 0.07, 0.18);
  tone(1174, 1174, 0.22, 0.08, 0.36);
}

/**
 * Call once from a user-gesture handler (pointerdown) to unlock AudioContext on iOS.
 * iOS requires a user gesture before AudioContext can produce sound. After this call,
 * all subsequent playXxx() calls work regardless of gesture context.
 */
export function unlockAudio(): void {
  getCtx();
}
