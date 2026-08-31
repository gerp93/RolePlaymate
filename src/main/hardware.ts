/**
 * Inventory of this machine's CPU, RAM, and GPUs. Used only to feed the Model Tuning page's
 * speed heuristic -- chat itself never reads this; Ollama still picks its own device.
 *
 * Sources, in order of trust for VRAM: nvidia-smi, Linux sysfs, macOS system_profiler,
 * then Chromium's GPU list (names are reliable, VRAM usually isn't). Missing numbers stay
 * null -- we never invent VRAM from a card name. CPU/RAM still come from `os`, which Node
 * always has.
 */
import { app } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HardwareSnapshot, GpuInfo, GpuVendor, GpuVramSource } from '../shared/types/hardware';
import {
  isDiscreteGpu,
  isPlaceholderGpu,
  vendorFromName,
} from '../shared/utils/hardwareFit';

let cached: HardwareSnapshot | null = null;

export async function getHardwareSnapshot(): Promise<HardwareSnapshot> {
  if (cached) return cached;
  cached = await collectHardwareSnapshot();
  return cached;
}

interface ElectronGpuDevice {
  vendorId?: number;
  deviceId?: number;
  active?: boolean;
  vendorString?: string;
  deviceString?: string;
  driverVendor?: string;
  driverVersion?: string;
}

interface ElectronGpuInfo {
  gpuDevice?: ElectronGpuDevice[];
}

const VENDOR_ID: Record<number, GpuVendor> = {
  0x10de: 'nvidia',
  0x1002: 'amd',
  0x8086: 'intel',
  0x106b: 'apple',
};

async function collectHardwareSnapshot(): Promise<HardwareSnapshot> {
  const cpus = os.cpus();
  const cpuModel = (cpus[0]?.model ?? '').replace(/\s+/g, ' ').trim();
  const ramBytes = os.totalmem();
  const unifiedMemory = process.platform === 'darwin' && (os.arch() === 'arm64' || /apple/i.test(cpuModel));

  const [electronGpus, nvidiaGpus, extraGpus, osLabel] = await Promise.all([
    readElectronGpus(),
    readNvidiaSmi(),
    process.platform === 'linux'
      ? readLinuxDrm()
      : process.platform === 'darwin'
        ? readMacDisplays()
        : Promise.resolve([] as GpuInfo[]),
    readOsLabel(),
  ]);

  const gpus = mergeGpus([...electronGpus, ...nvidiaGpus, ...extraGpus]);

  if (unifiedMemory) {
    const apple = gpus.find((g) => g.vendor === 'apple') ?? gpus[0];
    if (apple) {
      apple.vendor = 'apple';
    }
  }

  return {
    platform: process.platform,
    osLabel,
    arch: os.arch(),
    ramBytes,
    unifiedMemory,
    cpu: {
      model: cpuModel,
      cores: cpus.length,
      speedMHz: cpus[0]?.speed ?? 0,
    },
    gpus: gpus.filter((g) => !isPlaceholderGpu(g.name)),
  };
}

async function readElectronGpus(): Promise<GpuInfo[]> {
  try {
    const info = (await withTimeout(app.getGPUInfo('complete'), 4000, null)) as ElectronGpuInfo | null;
    const devices = info?.gpuDevice ?? [];
    const seen = new Set<string>();
    const gpus: GpuInfo[] = [];
    for (const device of devices) {
      const name = (device.deviceString || device.vendorString || '').trim();
      if (!name || isPlaceholderGpu(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const vendor =
        (device.vendorId != null ? VENDOR_ID[device.vendorId] : undefined) ?? vendorFromName(name);
      gpus.push({
        name,
        vendor,
        vramBytes: null,
        discrete: isDiscreteGpu(name, vendor),
        vramSource: 'electron',
      });
    }
    return gpus;
  } catch {
    return [];
  }
}

async function readNvidiaSmi(): Promise<GpuInfo[]> {
  const exe = process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi';
  const stdout = await execFileTimed(exe, ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], 2500);
  if (!stdout) return [];
  const gpus: GpuInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const comma = trimmed.lastIndexOf(',');
    if (comma < 0) continue;
    const name = trimmed.slice(0, comma).trim();
    const mib = parseFloat(trimmed.slice(comma + 1).trim());
    if (!name || !Number.isFinite(mib)) continue;
    gpus.push({
      name,
      vendor: 'nvidia',
      vramBytes: Math.round(mib * 1024 * 1024),
      discrete: true,
      vramSource: 'nvidia-smi',
    });
  }
  return gpus;
}

async function readLinuxDrm(): Promise<GpuInfo[]> {
  const drmRoot = '/sys/class/drm';
  let cards: string[] = [];
  try {
    cards = fs.readdirSync(drmRoot).filter((name) => /^card\d+$/.test(name));
  } catch {
    return [];
  }
  const gpus: GpuInfo[] = [];
  for (const card of cards) {
    const deviceDir = path.join(drmRoot, card, 'device');
    let vramBytes: number | null = null;
    try {
      const raw = fs.readFileSync(path.join(deviceDir, 'mem_info_vram_total'), 'utf8').trim();
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) vramBytes = parsed;
    } catch {
      // Integrated / virtual adapters often omit this file.
    }
    let name = card;
    try {
      const uevent = fs.readFileSync(path.join(deviceDir, 'uevent'), 'utf8');
      const driver = /^DRIVER=(.+)$/m.exec(uevent)?.[1]?.trim();
      if (driver) name = driver;
    } catch {
      // Keep cardN.
    }
    const vendor = vendorFromName(name);
    gpus.push({
      name,
      vendor,
      vramBytes,
      discrete: isDiscreteGpu(name, vendor) || (vramBytes != null && vramBytes >= 2 * 1024 ** 3),
      vramSource: 'sysfs',
    });
  }
  return gpus;
}

interface SpDisplaysItem {
  sppci_model?: string;
  spdisplays_vendor?: string;
  _name?: string;
  spdisplays_vram?: string;
  spdisplays_vram_shared?: string;
}

async function readMacDisplays(): Promise<GpuInfo[]> {
  const stdout = await execFileTimed('system_profiler', ['SPDisplaysDataType', '-json'], 4000);
  if (!stdout) return [];
  try {
    const parsed = JSON.parse(stdout) as { SPDisplaysDataType?: SpDisplaysItem[] };
    const items = parsed.SPDisplaysDataType ?? [];
    return items.map((item) => {
      const name = (item.sppci_model || item._name || 'GPU').trim();
      const vendor = vendorFromName(`${name} ${item.spdisplays_vendor ?? ''}`);
      const vramBytes = parseMacVram(item.spdisplays_vram || item.spdisplays_vram_shared);
      return {
        name,
        vendor,
        vramBytes,
        discrete: isDiscreteGpu(name, vendor),
        vramSource: 'system-profiler' as GpuVramSource,
      };
    });
  } catch {
    return [];
  }
}

function parseMacVram(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = raw.trim().match(/^([\d.]+)\s*(GB|MB|G|M)/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  return /g/i.test(match[2]) ? value * 1024 ** 3 : value * 1024 ** 2;
}

function mergeGpus(found: GpuInfo[]): GpuInfo[] {
  const merged: GpuInfo[] = [];
  for (const gpu of found) {
    const existing = merged.find((g) => gpuNamesMatch(g.name, gpu.name));
    if (!existing) {
      merged.push({ ...gpu });
      continue;
    }
    if (existing.vramBytes == null && gpu.vramBytes != null) {
      existing.vramBytes = gpu.vramBytes;
      existing.vramSource = gpu.vramSource;
    }
    if (!existing.discrete && gpu.discrete) existing.discrete = true;
    if (gpu.name.length > existing.name.length) existing.name = gpu.name;
  }
  return merged;
}

function gpuNamesMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/nvidia|geforce|amd|radeon|intel|\(r\)|\(tm\)|graphics|gpu/gi, '')
      .replace(/[^a-z0-9]+/g, '')
      .trim();
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

async function readOsLabel(): Promise<string> {
  if (process.platform === 'win32') {
    const version = os.version();
    if (version && /^windows/i.test(version)) return version;
    const release = os.release();
    const build = Number(release.split('.')[2]);
    const name = Number.isFinite(build) && build >= 22000 ? 'Windows 11' : 'Windows 10';
    return Number.isFinite(build) ? `${name} (build ${build})` : name;
  }
  if (process.platform === 'darwin') {
    const stdout = await execFileTimed('sw_vers', ['-productVersion'], 1500);
    const version = stdout?.trim();
    return version ? `macOS ${version}` : 'macOS';
  }
  try {
    const text = fs.readFileSync('/etc/os-release', 'utf8');
    const pretty = /^PRETTY_NAME=(.*)$/m.exec(text)?.[1]?.trim().replace(/^"|"$/g, '');
    if (pretty) return pretty;
  } catch {
    // Fall through.
  }
  return 'Linux';
}

function execFileTimed(file: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) resolve(null);
        else resolve(typeof stdout === 'string' ? stdout : String(stdout));
      }
    );
    child.on('error', () => resolve(null));
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}
