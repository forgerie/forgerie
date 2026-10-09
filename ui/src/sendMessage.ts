import type { AppendMessage, ComposerRuntime } from "@assistant-ui/react";
import { promptOf, reusableAttachment, type PromptAttachment } from "./attachments";
import { NotSentError } from "./sessionStore";

/**
 * The binding's send boundary. An uncertain acknowledgement never auto-retries.
 * `report` learns whether the message may have reached the server: a refusal
 * before any request, or a draft that could not become a prompt, did not.
 */
export async function sendMessage(message: AppendMessage, send: (text: string, attachments?: PromptAttachment[]) => Promise<void>,
  currentComposer: () => ComposerRuntime | undefined, report: (error: string, outcome: { mayHaveSent: boolean }) => void): Promise<void> {
  let prepared = false;
  try {
    const prompt = promptOf(message);
    prepared = true;
    await send(prompt.text, prompt.attachments);
  } catch (error) {
    const composer = currentComposer();
    if (composer) {
      const mayHaveSent = prepared && !(error instanceof NotSentError);
      report(mayHaveSent ? `${error instanceof Error ? error.message : String(error)} Check the transcript before sending again.`
        : error instanceof Error ? error.message : String(error), { mayHaveSent });
      const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
      composer.setText([text, composer.getState().text].filter(Boolean).join("\n"));
      for (const attachment of message.attachments ?? []) await composer.addAttachment(reusableAttachment(attachment));
    }
    // Drop assistant-ui's temporary in-transit row. Restore explicitly instead
    // of MessageNotSentError: transport failure does not prove non-delivery.
    throw error;
  }
}
