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
  measuredAt: "2026-08-28T22:43:36.504Z",
  measuredWith: "scripts/speech-runtime-benchmark.mjs",
  host: "zao x86_64-linux NixOS 6.18.17, pinned Forgerie Smart Turn v3.2 framed-binary v2 worker and isolated whisper.cpp base.en framed worker",
  hostTotalMemoryBytes: 33_370_378_240,
  sampleDurationsSeconds: [3, 10, 30, 60, 600],
  fixtureKind: "generated-non-sensitive-tts-speech",
  repeatedTurns: 20,
  contentionTurns: 20,
  maxTurnSeconds: SPEECH_POLICY.audio.maxTurnSeconds,
  maxTurnBytes: SPEECH_POLICY.audio.maxTurnBytes,
  endpointWindowBytes: SPEECH_POLICY.audio.endpointWindowBytes,
  benchmarkNodePeakCopyRssBytes: 172_474_368,
  persistentWarmthMemoryFraction: SPEECH_POLICY.process.persistentWarmthMaxMemoryFraction,
  persistentWarmthThresholdBytes: 25_027_783_680,
  peakActiveAgentWorkloadRssBytes: 12_734_013_440,
  activeAgentWorkloadLifetimeCgroupPeakBytes: 15_909_810_176,
  activeAgentWorkloadSource: "systemd user service cgroup memory.current for forgerie-sessiond.service plus forgerie-web.service sampled during benchmark; memory.peak is lifetime context only",
  speechPeakRssBytes: 1_255_829_504,
  persistentWarmthCombinedPeakBytes: 13_989_842_944,
  persistentWarmthAccepted: true,
  persistentWarmthProvisional: false,
  smartTurnColdReadyMs: 828.42,
  smartTurnWarmEndpointP95Ms: 82.75,
  smartTurnMaxFixtureMs: 86.36,
  smartTurnPeakRssBytes: 300_695_552,
  whisperWorkerReadyMs: 326.56,
  whisperReadyAfterRepresentativeInferenceMs: 1_171.57,
  whisperWarmTranscriptionP95Ms: 972.44,
  whisperMaxTurnFixtureMs: 33_051.49,
  whisperPeakRssBytes: 944_992_256,
  whisperSixtySecondFixtureMs: 2_449.83,
  whisperSixtySecondPeakRssBytes: 676_909_056,
  activeQueuedContentionP95Ms: 3_027.75,
  activeQueuedContentionPeakRssBytes: 941_883_392,
  queuedCancellationObservation: "Queued caller cancellation before a Whisper frame write returned in 0.02 ms while the active request settled 1327.55 ms later; U2 service queue tests cover adapter-owned queued cancellation.",
  activeCancellationObservation: "The framed Whisper protocol has no per-request cancellation frame; active cancellation is representable only by terminating the whole worker or by caller-side observation stop while the backend slot remains busy.",
  forcedTerminationObservation: "Forced framed Whisper SIGKILL produced runtime stdout closure, terminated in 1314.03 ms, then restarted without intentional old/new worker overlap.",
  forcedTerminationRestartMs: 1_256.35,
  replacementOverlapObserved: false,
  notes: [
    "Whisper latency evidence uses generated non-sensitive TTS speech fixtures at 3, 10, 30, 60, and 600 seconds; the benchmark deletes transient WAV files and never prints recognized transcript text.",
    "The measured generated-speech 600-second Whisper fixture completed in 33051.49 ms and the 20 repeated three-second turns had 972.44 ms p95 latency, so a 120-second queue-inclusive operation deadline keeps headroom without preserving hidden compute indefinitely.",
    "Operation RSS samples include the benchmark Node process and child process trees during work; the highest Node-side PCM/WAV/frame-copy RSS observed was 172474368 bytes.",
    "Smart Turn stayed below 86.36 ms for three-second and endpoint-window fixtures; endpoint p95 over 20 repeated checks was 82.75 ms.",
    "The active-plus-queued contention probe ran 20 iterations with one active Whisper frame, one queued Whisper frame, and one Smart Turn endpoint check; contention p95 was 3027.75 ms with 941883392 bytes sampled peak RSS.",
    "The active Forgerie workload measurement used sampled memory.current from the systemd user cgroups for forgerie-sessiond.service and forgerie-web.service; speech peak plus active workload peak was 13989842944 bytes, below the 25027783680-byte 75% host-memory budget. The higher memory.peak value is recorded only as lifetime cgroup context.",
    "One active and one queued operation per backend are the only admitted model slots; queue wait and inference share the same operationDeadlineMs contract.",
  ],
  evidenceGaps: [
    "Physical Fold microphone, thermal, and foreground posture evidence belongs to U10/U8 and is not replaced by generated-speech host benchmarking.",
    "The framed worker has no per-request cancellation message. U2 process-adapter tests still own queued cancellation before frame write and hard-deadline wedged-inference termination; this benchmark proves real framed-worker termination, restart time, and no intentional replacement overlap.",
  ],
};
