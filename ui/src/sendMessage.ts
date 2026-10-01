import type { AppendMessage, ComposerRuntime } from "@assistant-ui/react";
import { promptOf, reusableAttachment, type PromptAttachment } from "./attachments";
import { NotSentError } from "./sessionStore";

/** The binding's send boundary. An uncertain acknowledgement never auto-retries. */
export async function sendMessage(message: AppendMessage, send: (text: string, attachments?: PromptAttachment[]) => Promise<void>,
  currentComposer: () => ComposerRuntime | undefined, report: (error: string) => void): Promise<void> {
  try {
    const prompt = promptOf(message);
    await send(prompt.text, prompt.attachments);
  } catch (error) {
    const composer = currentComposer();
    if (composer) {
      // A refusal before any request cannot have reached the transcript.
      report(error instanceof NotSentError ? error.message
        : `${error instanceof Error ? error.message : String(error)} Check the transcript before sending again.`);
      const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
      composer.setText([text, composer.getState().text].filter(Boolean).join("\n"));
      for (const attachment of message.attachments ?? []) await composer.addAttachment(reusableAttachment(attachment));
    }
    // Drop assistant-ui's temporary in-transit row. Restore explicitly instead
    // of MessageNotSentError: transport failure does not prove non-delivery.
    throw error;
  }
}
