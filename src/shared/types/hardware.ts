/**
 * What this computer can tell us about itself -- enough to guess how an Ollama model will
 * feel to run, not a full inventory. Collected in the main process (Node/Electron can see the
 * OS; the renderer cannot) and rated in shared code so the heuristic stays testable without
 * spinning up Electron.
 *
 * This is always *this machine*, not the Ollama host. If the user points Ollama at another
 * computer, the speed column is still describing the box RolePlaymate is running on.
 */

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'other';

export type GpuVramSource = 'nvidia-smi' | 'sysfs' | 'system-profiler' | 'electron' | 'unified';

export interface GpuInfo {
  name: string;
  vendor: GpuVendor;
  /** Null when nothing reported a number and the name didn't match a known card. */
  vramBytes: number | null;
  discrete: boolean;
  vramSource: GpuVramSource;
}

export interface CpuInfo {
  model: string;
  /** Logical processors (hyperthreads count). */
  cores: number;
  speedMHz: number;
}

export interface HardwareSnapshot {
  platform: 'win32' | 'darwin' | 'linux' | string;
  /** Human label, e.g. "Windows 11 Pro" or "Ubuntu 24.04". */
  osLabel: string;
  arch: string;
  ramBytes: number;
  /** Apple Silicon: RAM and GPU memory are the same pool. */
  unifiedMemory: boolean;
  cpu: CpuInfo;
  gpus: GpuInfo[];
}

/** Expected generation speed on this machine -- independent of the Good/Better/Best quality tier. */
export type SpeedTier = 'Fast' | 'OK' | 'Slow';

export interface ModelSpeedRating {
  tier: SpeedTier;
  /** 0–1, higher = expected to generate faster. Absolute, not ranked among installed models. */
  score: number;
  /** 0 = fully on GPU, 1 = entirely CPU (or swap). */
  offloadFraction: number;
  /** One-line explanation for a tooltip -- names the bottleneck, not the formula. */
  summary: string;
}
