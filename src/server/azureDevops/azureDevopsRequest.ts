import type { AzureCredentialSource } from "./azureDevopsCredentials.js";

/** Attach a server-only authorization header. Retry a 401 once, never replay a mutation. */
export async function azureDevopsRequest(credentials: AzureCredentialSource, organization: string, url: string, init: RequestInit, fetcher: (url: string, init: RequestInit) => Promise<Response>): Promise<{ ok: true; response: Response } | { ok: false; message: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const credential = await credentials.read(organization);
    if (!credential.ok) return credential;
    const headers = new Headers(init.headers);
    headers.set("Authorization", credential.authorization);
    const response = await fetcher(url, { ...init, headers });
    if (response.status !== 401) return { ok: true, response };
    await response.body?.cancel();
    credentials.invalidate(credential.authorization);
  }
  return { ok: false, message: `Azure DevOps rejected the credentials. ${credentials.fixMessage(organization)}` };
}
