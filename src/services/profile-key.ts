/** Stable local namespace; never returns the API credential itself. */
export async function profileKey(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}
