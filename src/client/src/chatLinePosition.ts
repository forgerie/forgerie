export interface ChatLineTranscriptPosition {
  readonly messageIndex: number;
  readonly lineIndex: number;
  readonly segmentIndex: number;
}

interface PositionedLine {
  readonly transcriptPosition?: ChatLineTranscriptPosition | undefined;
}

/** Attach source location without adding it to serialized or equality-visible message data. */
export function setChatLineTranscriptPosition<Line extends object>(line: Line, position: ChatLineTranscriptPosition): Line {
  Object.defineProperty(line, "transcriptPosition", { configurable: true, value: position });
  return line;
}

/** Preserve hidden source location when message projection creates a replacement object. */
export function inheritChatLineTranscriptPosition<Line extends object>(source: PositionedLine, target: Line): Line {
  return source.transcriptPosition === undefined ? target : setChatLineTranscriptPosition(target, source.transcriptPosition);
}
