import { HardwareSnapshot, GpuInfo, GpuVendor, ModelSpeedRating, SpeedTier } from '../types/hardware';

export const SPEED_TIER_COLORS: Record<SpeedTier, string> = {
  Fast: 'var(--color-accent-green)',
  OK: 'var(--color-accent-blue)',
  Slow: 'var(--color-text-muted)',
};

const GIB = 1024 ** 3;

/** RAM/VRAM for display -- binary GB, rounded the way people read "32 GB" / "12 GB". */
export function formatGib(bytes: number): string {
  if (!bytes) return '';
  const gib = bytes / GIB;
  if (gib >= 2) return `${Math.round(gib)} GB`;
  if (gib >= 0.1) return `${gib.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 ** 2))} MB`;
}

/** "12.2B" / "638M" -> billions of parameters. 0 for anything unparsed. */
export function paramsInBillions(parameterSize: string): number {
  const match = parameterSize.match(/^([\d.]+)\s*([BM])$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  return match[2].toUpperCase() === 'B' ? value : value / 1000;
}

/**
 * The GPU Ollama is most likely to use: the discrete card with the most VRAM, else the
 * Apple/unified adapter, else whatever we found. Ignores Microsoft Basic / SwiftShader.
 */
export function primaryGpu(hardware: HardwareSnapshot): GpuInfo | null {
  const usable = hardware.gpus.filter((g) => !isPlaceholderGpu(g.name));
  if (usable.length === 0) return null;
  const discrete = usable.filter((g) => g.discrete);
  const pool = discrete.length > 0 ? discrete : usable;
  return [...pool].sort((a, b) => (b.vramBytes ?? 0) - (a.vramBytes ?? 0))[0];
}

export function isPlaceholderGpu(name: string): boolean {
  return /basic (render|display)|swiftshader|llvmpipe|microsoft basic|citrix|remote display/i.test(
    name
  );
}

export function vendorFromName(name: string): GpuVendor {
  const n = name.toLowerCase();
  if (/nvidia|geforce|quadro|tesla|rtx |gtx /.test(n)) return 'nvidia';
  if (/\bradeon\b|\brx\s*\d/.test(n) || /\bamd\b/.test(n)) return 'amd';
  if (/\bintel\b|\barc\b|iris|uhd graphics|hd graphics/.test(n)) return 'intel';
  if (/apple|m[1-4]\s*(pro|max|ultra)?/i.test(n) && !/intel/.test(n)) return 'apple';
  return 'other';
}

export function isDiscreteGpu(name: string, vendor: GpuVendor): boolean {
  const n = name.toLowerCase();
  if (vendor === 'apple') return false;
  if (vendor === 'nvidia') return !/tegra/.test(n);
  if (vendor === 'amd') return /\brx\s*\d|radeon\s+pro|radeon\s+vii/.test(n);
  if (vendor === 'intel') return /\barc\b/.test(n);
  return false;
}

/**
 * Relative GPU throughput when the model fits in VRAM. 1.0 is a current flagship; integrated
 * and old cards sit much lower so a 7B that "fits" in iGPU memory is still Slow/OK, not Fast.
 */
export function gpuThroughputClass(name: string, vendor: GpuVendor): number {
  const n = name.toLowerCase();
  const rules: [RegExp, number][] = [
    [/rtx\s*5090/, 1.0],
    [/rtx\s*5080/, 0.95],
    [/rtx\s*5070/, 0.85],
    [/rtx\s*5060/, 0.72],
    [/rtx\s*4090/, 0.98],
    [/rtx\s*4080/, 0.9],
    [/rtx\s*4070/, 0.82],
    [/rtx\s*4060/, 0.68],
    [/rtx\s*4050/, 0.55],
    [/rtx\s*3090/, 0.85],
    [/rtx\s*3080/, 0.78],
    [/rtx\s*3070/, 0.7],
    [/rtx\s*3060/, 0.58],
    [/rtx\s*3050/, 0.45],
    [/rtx\s*20/, 0.48],
    [/gtx\s*16/, 0.35],
    [/gtx\s*10/, 0.32],
    [/\bmx\s*\d/, 0.22],
    [/m4\s*ultra/, 1.0],
    [/m4\s*max/, 0.95],
    [/m4\s*pro/, 0.88],
    [/\bm4\b/, 0.78],
    [/m3\s*ultra/, 0.92],
    [/m3\s*max/, 0.9],
    [/m3\s*pro/, 0.82],
    [/\bm3\b/, 0.72],
    [/m2\s*ultra/, 0.85],
    [/m2\s*max/, 0.82],
    [/m2\s*pro/, 0.72],
    [/\bm2\b/, 0.62],
    [/m1\s*ultra/, 0.72],
    [/m1\s*max/, 0.7],
    [/m1\s*pro/, 0.6],
    [/\bm1\b/, 0.5],
    [/rx\s*90/, 0.9],
    [/rx\s*7900/, 0.82],
    [/rx\s*7800/, 0.72],
    [/rx\s*7700/, 0.65],
    [/rx\s*7600/, 0.55],
    [/rx\s*6/, 0.58],
    [/arc\s*b/, 0.5],
    [/arc\s*a/, 0.42],
    [/iris/, 0.25],
    [/uhd graphics|hd graphics/, 0.18],
  ];
  for (const [pattern, value] of rules) {
    if (pattern.test(n)) return value;
  }
  if (vendor === 'nvidia') return 0.6;
  if (vendor === 'amd') return 0.55;
  if (vendor === 'intel') return 0.22;
  if (vendor === 'apple') return 0.7;
  return 0.35;
}

function cpuThroughputClass(cores: number, speedMHz: number): number {
  const coreFactor = Math.min(Math.max(cores, 1) / 16, 1);
  const speedFactor = Math.min(Math.max(speedMHz, 1800) / 4200, 1);
  return 0.08 + 0.1 * coreFactor + 0.04 * speedFactor;
}

function usableGpuBytes(hardware: HardwareSnapshot, gpu: GpuInfo | null): number | null {
  if (hardware.unifiedMemory) {
    return hardware.ramBytes * 0.7;
  }
  if (!gpu) return 0;
  if (gpu.vramBytes == null) return null;
  if (gpu.discrete) return gpu.vramBytes;
  return Math.min(gpu.vramBytes, 8 * GIB);
}

/** Why On this PC can't be rated -- named missing input, not a generic failure. */
export function hardwareSpeedUnavailableReason(hardware: HardwareSnapshot): string | null {
  if (hardware.unifiedMemory) return null;
  const gpu = primaryGpu(hardware);
  if (gpu && gpu.vramBytes == null) {
    return `VRAM not reported for ${gpu.name} — can't estimate speed without a measured size.`;
  }
  return null;
}

function workingSetBytes(sizeBytes: number): number {
  // Weights plus a modest KV-cache overhead at typical chat context -- not the model's
  // advertised max context, which would make every long-context model look unrunnable.
  return sizeBytes * 1.2;
}

function scoreToTier(score: number): SpeedTier {
  if (score >= 0.4) return 'Fast';
  if (score >= 0.18) return 'OK';
  return 'Slow';
}

function summarize(args: {
  tier: SpeedTier;
  offloadFraction: number;
  unified: boolean;
  gpu: GpuInfo | null;
  workingSet: number;
  usableGpu: number;
  ramBytes: number;
}): string {
  const { tier, offloadFraction, unified, gpu, workingSet, usableGpu, ramBytes } = args;
  const size = formatGib(workingSet);
  if (unified) {
    if (workingSet > ramBytes * 0.9) {
      return `Needs about ${size} of unified memory -- more than this Mac has free, so it will likely swap.`;
    }
    if (tier === 'Fast') return `Fits in unified memory (${formatGib(ramBytes)} RAM) -- expected to generate quickly.`;
    if (tier === 'OK') return `Fits in unified memory, but this is a large model -- replies will take a bit.`;
    return `Fits, but this chip will still generate slowly at this size.`;
  }
  if (!gpu || usableGpu <= 0) {
    return `No usable GPU memory detected -- this would run on CPU (${tier === 'Slow' ? 'slowly' : 'usable for a small model'}).`;
  }
  const vram = formatGib(usableGpu);
  if (offloadFraction <= 0.08) {
    return `Fits in ${gpu.name}'s ${vram} VRAM -- expected to generate quickly.`;
  }
  if (offloadFraction < 0.5) {
    return `About ${Math.round(offloadFraction * 100)}% would spill out of ${vram} VRAM onto system RAM -- usable, but slower than a full-GPU fit.`;
  }
  if (workingSet > ramBytes * 0.85) {
    return `Needs about ${size}; this machine has ${formatGib(ramBytes)} RAM plus ${vram} VRAM -- likely to swap and stall.`;
  }
  return `Mostly CPU offload (${Math.round(offloadFraction * 100)}% outside ${vram} VRAM) -- replies will take a while.`;
}

/**
 * Absolute speed guess for one installed model on this snapshot. Null when we don't even
 * have a file size (orphaned sampler rows, models Ollama didn't report a size for).
 *
 * Independent of the quality tier: a 70B can be Best and Slow on the same machine; a 7B can
 * be Good and Fast. The overlap is the point of showing both columns.
 */
export function rateModelOnHardware(
  model: { sizeBytes: number; parameterSize: string },
  hardware: HardwareSnapshot
): ModelSpeedRating | null {
  if (!model.sizeBytes || model.sizeBytes <= 0) return null;

  const gpu = primaryGpu(hardware);
  const usableGpu = usableGpuBytes(hardware, gpu);
  if (usableGpu == null) return null;
  const workingSet = workingSetBytes(model.sizeBytes);
  const offload = Math.max(0, workingSet - usableGpu);
  const offloadFraction = Math.min(1, offload / workingSet);

  const gpuClass = gpu ? gpuThroughputClass(gpu.name, gpu.vendor) : 0;
  const cpuClass = cpuThroughputClass(hardware.cpu.cores, hardware.cpu.speedMHz);
  const effective = gpuClass * (1 - offloadFraction) + cpuClass * offloadFraction;

  const params = paramsInBillions(model.parameterSize);
  const paramFactor = 1 / (1 + Math.max(params, 0.4) / 28);
  const score = Math.max(0, Math.min(1, effective * paramFactor));
  const tier = scoreToTier(score);

  return {
    tier,
    score,
    offloadFraction,
    summary: summarize({
      tier,
      offloadFraction,
      unified: hardware.unifiedMemory,
      gpu,
      workingSet,
      usableGpu,
      ramBytes: hardware.ramBytes,
    }),
  };
}
