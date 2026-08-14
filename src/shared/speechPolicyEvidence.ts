import { SPEECH_POLICY } from "./speechPolicy.js";

export interface SpeechPolicyEvidence {
  readonly measuredAt: string;
  readonly measuredWith: "scripts/speech-runtime-benchmark.mjs";
  readonly host: string;
  readonly hostTotalMemoryBytes: number;
  readonly sampleDurationsSeconds: readonly number[];
  readonly fixtureKind: "generated-non-sensitive-tts-speech";
  readonly repeatedTurns: number;
  readonly contentionTurns: number;
  readonly maxTurnSeconds: number;
  readonly maxTurnBytes: number;
  readonly endpointWindowBytes: number;
  readonly benchmarkNodePeakCopyRssBytes: number;
  readonly persistentWarmthMemoryFraction: number;
  readonly persistentWarmthThresholdBytes: number;
  readonly peakActiveAgentWorkloadRssBytes: number;
  readonly activeAgentWorkloadLifetimeCgroupPeakBytes: number;
  readonly activeAgentWorkloadSource: string;
  readonly speechPeakRssBytes: number;
  readonly persistentWarmthCombinedPeakBytes: number;
  readonly persistentWarmthAccepted: boolean;
  readonly persistentWarmthProvisional: boolean;
  readonly smartTurnColdReadyMs: number;
  readonly smartTurnWarmEndpointP95Ms: number;
  readonly smartTurnMaxFixtureMs: number;
  readonly smartTurnPeakRssBytes: number;
  readonly whisperWorkerReadyMs: number;
  readonly whisperReadyAfterRepresentativeInferenceMs: number;
  readonly whisperWarmTranscriptionP95Ms: number;
  readonly whisperMaxTurnFixtureMs: number;
  readonly whisperPeakRssBytes: number;
  readonly whisperSixtySecondFixtureMs: number;
  readonly whisperSixtySecondPeakRssBytes: number;
  readonly activeQueuedContentionP95Ms: number;
  readonly activeQueuedContentionPeakRssBytes: number;
  readonly queuedCancellationObservation: string;
  readonly activeCancellationObservation: string;
  readonly forcedTerminationObservation: string;
  readonly forcedTerminationRestartMs: number;
  readonly replacementOverlapObserved: boolean;
  readonly notes: readonly string[];
  readonly evidenceGaps: readonly string[];
}

export const SPEECH_POLICY_EVIDENCE: SpeechPolicyEvidence = {
  measuredAt: "2026-08-14T08:00:48.539Z",
  measuredWith: "scripts/speech-runtime-benchmark.mjs",
  host: "zao x86_64-linux NixOS 6.18.17, pinned Forgerie Smart Turn v3.2 framed-binary v2 worker and isolated whisper.cpp base.en framed worker",
  hostTotalMemoryBytes: 33_370_378_240,
  sampleDurationsSeconds: [3, 10, 30, 60],
  fixtureKind: "generated-non-sensitive-tts-speech",
  repeatedTurns: 20,
  contentionTurns: 20,
  maxTurnSeconds: SPEECH_POLICY.audio.maxTurnSeconds,
  maxTurnBytes: SPEECH_POLICY.audio.maxTurnBytes,
  endpointWindowBytes: SPEECH_POLICY.audio.endpointWindowBytes,
  benchmarkNodePeakCopyRssBytes: 143_912_960,
  persistentWarmthMemoryFraction: SPEECH_POLICY.process.persistentWarmthMaxMemoryFraction,
  persistentWarmthThresholdBytes: 25_027_783_680,
  peakActiveAgentWorkloadRssBytes: 6_615_736_320,
  activeAgentWorkloadLifetimeCgroupPeakBytes: 18_026_790_912,
  activeAgentWorkloadSource: "systemd user cgroup memory.current for forgerie-sessiond.service plus forgerie-web.service sampled during characterization; memory.peak is lifetime context only",
  speechPeakRssBytes: 1_113_636_864,
  persistentWarmthCombinedPeakBytes: 7_729_373_184,
  persistentWarmthAccepted: true,
  persistentWarmthProvisional: false,
  smartTurnColdReadyMs: 739.28,
  smartTurnWarmEndpointP95Ms: 58.27,
  smartTurnMaxFixtureMs: 61.77,
  smartTurnPeakRssBytes: 259_964_928,
  whisperWorkerReadyMs: 242.33,
  whisperReadyAfterRepresentativeInferenceMs: 1_143.95,
  whisperWarmTranscriptionP95Ms: 926.14,
  whisperMaxTurnFixtureMs: 2_288.46,
  whisperPeakRssBytes: 673_857_536,
  whisperSixtySecondFixtureMs: 2_288.46,
  whisperSixtySecondPeakRssBytes: 635_850_752,
  activeQueuedContentionP95Ms: 2_310.47,
  activeQueuedContentionPeakRssBytes: 800_542_720,
  queuedCancellationObservation: "Queued caller cancellation before a Whisper frame write returned in 0.02 ms while the active request settled 1050.99 ms later; U2 service queue tests cover adapter-owned queued cancellation.",
  activeCancellationObservation: "The framed Whisper protocol has no per-request cancellation frame; active cancellation is representable only by terminating the whole worker or by caller-side observation stop while the backend slot remains busy.",
  forcedTerminationObservation: "Forced framed Whisper SIGKILL produced runtime stdout closure, terminated in 1166.72 ms, then restarted without intentional old/new worker overlap.",
  forcedTerminationRestartMs: 1_096.98,
  replacementOverlapObserved: false,
  notes: [
    "Whisper latency evidence uses generated non-sensitive TTS speech fixtures at 3, 10, 30, and 60 seconds; the benchmark deletes transient WAV files and never prints recognized transcript text.",
    "The measured generated-speech 60-second Whisper fixture completed in 2288.46 ms and the 20 repeated three-second turns had 926.14 ms p95 latency, so a 10-second queue-inclusive operation deadline keeps headroom without preserving hidden compute indefinitely.",
    "Operation RSS samples include the benchmark Node process and child process trees during work; the highest Node-side PCM/WAV/frame-copy RSS observed was 143912960 bytes.",
    "Smart Turn stayed below 61.77 ms across 3-, 10-, 30-, and 60-second submitted buffers because the worker evaluates only the latest eight seconds; endpoint p95 over 20 repeated checks was 58.27 ms.",
    "The active-plus-queued contention probe ran 20 iterations with one active Whisper frame, one queued Whisper frame, and one Smart Turn endpoint check; contention p95 was 2310.47 ms with 800542720 bytes sampled peak RSS.",
    "The active Forgerie workload measurement used sampled memory.current from the systemd user cgroups for forgerie-sessiond.service and forgerie-web.service; speech peak plus active workload peak was 7729373184 bytes, below the 25027783680-byte 75% host-memory budget. The higher memory.peak value is recorded only as lifetime cgroup context.",
    "One active and one queued operation per backend are the only admitted model slots; queue wait and inference share the same operationDeadlineMs contract.",
  ],
  evidenceGaps: [
    "Physical Fold microphone, thermal, and foreground posture evidence belongs to U10/U8 and is not replaced by generated-speech host benchmarking.",
    "The framed worker has no per-request cancellation message. U2 process-adapter tests still own queued cancellation before frame write and hard-deadline wedged-inference termination; this benchmark proves real framed-worker termination, restart time, and no intentional replacement overlap.",
  ],
};
