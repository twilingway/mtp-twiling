import { readFile, writeFile } from "node:fs/promises";

export const queryInterval = 300000;
export class WaitForCi extends Error {}

export async function queryState(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export function queryAllowed(state, now) {
  return now >= Math.max((state.at ?? -queryInterval) + queryInterval, state.notBefore ?? 0);
}

export async function reserveQuery(file, sha, now = Date.now()) {
  const previous = await queryState(file);
  if (!queryAllowed(previous, now)) return false;
  await writeFile(file, JSON.stringify({ sha, at: now, notBefore: previous.notBefore ?? 0 }));
  return true;
}

export function responseNotBefore(response, now) {
  let until = 0;
  const retry = response.headers.get("retry-after");
  if (retry !== null) {
    const seconds = Number(retry);
    until = Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(retry) || 0;
  }
  if ([403, 429].includes(response.status)) until = Math.max(until, now + queryInterval);
  if (
    response.headers.get("x-ratelimit-remaining") === "0" ||
    [403, 429].includes(response.status)
  ) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(reset)) until = Math.max(until, reset * 1000);
  }
  return until;
}

export async function githubRequest(url, headers, file, fetcher = fetch, now = Date.now) {
  const previous = await queryState(file);
  if (now() < (previous.notBefore ?? 0)) throw new WaitForCi("GitHub rate limit cooldown");
  let response;
  try {
    response = await fetcher(url, { headers, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new WaitForCi("GitHub CI temporarily unavailable; keeping current release");
  }
  const until = responseNotBefore(response, now());
  if (until) {
    await writeFile(
      file,
      JSON.stringify({ ...previous, notBefore: Math.max(previous.notBefore ?? 0, until) })
    );
  }
  if (!response.ok) throw new WaitForCi(`GitHub CI unavailable: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new WaitForCi("Invalid GitHub CI response; keeping current release");
  }
}
