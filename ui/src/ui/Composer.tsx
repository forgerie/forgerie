// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import { AuiIf, ComposerPrimitive } from "@assistant-ui/react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";

// System molecule: unsupported attachments, model selection, and voice are not offered.
export function Composer() {
  return <ComposerPrimitive.Root className="composer">
    <div className="composer-shell">
      <ComposerPrimitive.Input aria-label="Message" placeholder="Send a message..." rows={1}
        className="composer-input" enterKeyHint="send" />
      <div className="composer-actions">
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send className="primary icon-button" aria-label="Send message" title="Send message">
            <ArrowUpIcon aria-hidden size={16} />
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel className="primary icon-button" aria-label="Stop generating" title="Stop generating">
            <SquareIcon aria-hidden size={12} fill="currentColor" />
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  </ComposerPrimitive.Root>;
}
