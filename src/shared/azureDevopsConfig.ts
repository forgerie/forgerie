import { Type, type Static } from "typebox";

/** Server executable selection only. No credentials are accepted in configuration. */
export const AzureDevopsGlobalConfigSchema = Type.Object({ azureCliCommand: Type.Optional(Type.String({ minLength: 1, maxLength: 32768 })) }, { additionalProperties: false });
export type AzureDevopsGlobalConfig = Static<typeof AzureDevopsGlobalConfigSchema>;
