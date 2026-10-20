// Pure soak schedule, argument and plateau rules. No I/O; unit-tested.
export const MAX_SOAK_MINUTES = 8 * 60;
// Real-device, live-provider and remote paths are outside this controlled soak.
export const UNSUPPORTED_SOAK_PATHS = Object.freeze(["real-phone", "live-provider-ttft", "tailnet-direct-vs-relay", "os-cold-cache"]);

export function soakOptions(argv) {
  const value = name => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const number = (name, fallback) => { const raw = value(name); return raw === undefined ? fallback : Number(raw); };
  const options = {
    fixture: value("fixture"), output: value("output"),
    durationMin: number("duration-min", MAX_SOAK_MINUTES), warmupMin: number("warmup-min", 30),
    blockMin: number("block-min", 20), sampleSec: number("sample-sec", 60), maxStartLoad: number("max-start-load", 16),
  };
  if (!options.fixture?.startsWith("/tmp/") || !options.fixture.endsWith("/fixture.json")) throw new Error("--fixture=/tmp/.../fixture.json from the native fixture launcher is required");
  if (!options.output?.startsWith("/tmp/")) throw new Error("--output=/tmp/NEW-DIRECTORY is required");
  for (const [name, min, max] of [["durationMin", 1, MAX_SOAK_MINUTES], ["warmupMin", 0, 120], ["blockMin", 1, 120], ["sampleSec", 5, 600], ["maxStartLoad", 0, 1024]]) {
    if (!Number.isFinite(options[name]) || options[name] < min || options[name] > max) throw new Error(`${name} must be from ${min} to ${max}`);
  }
  if (options.warmupMin >= options.durationMin) throw new Error("Warm-up must end before the soak ends");
  return options;
}

/** Phase at a given elapsed minute: warm-up, then repeating quiet → load → reconnect blocks. */
export function soakPhase(elapsedMin, { warmupMin, blockMin }) {
  if (elapsedMin < warmupMin) return "warmup";
  const offset = (elapsedMin - warmupMin) % blockMin;
  // Each block: 40% quiet, 50% load, 10% (at least one sample) reconnect.
  if (offset < blockMin * 0.4) return "quiet";
  if (offset < blockMin * 0.9) return "load";
  return "reconnect";
}

const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)]; };

/**
 * Compare a scalar's post-warm-up start window with its end window. Short or
 * sparse series are "insufficient"; a rise is reported, never called a leak.
 */
export function plateau(samples, metric, { warmupMin, windowMin = 30, tolerance = 0.1 }) {
  const points = samples.filter(sample => sample.elapsedMin >= warmupMin && Number.isFinite(sample[metric]));
  if (points.length < 10) return { metric, verdict: "insufficient", n: points.length };
  const last = points.at(-1).elapsedMin;
  if (last - warmupMin < windowMin * 2) return { metric, verdict: "insufficient", n: points.length };
  const start = median(points.filter(point => point.elapsedMin < warmupMin + windowMin).map(point => point[metric]));
  const end = median(points.filter(point => point.elapsedMin > last - windowMin).map(point => point[metric]));
  const growth = start === 0 ? (end === 0 ? 0 : Infinity) : (end - start) / start;
  return { metric, verdict: growth > tolerance ? "rising" : "plateau", n: points.length, startMedian: start, endMedian: end, growth };
}
