/* eslint-disable no-console */
import { runSimklTwoWaySync } from '@/lib/simklSync';
import type { UserSimklTokens } from '@/lib/watchStatus';

/**
 * Best-effort pull after connect (no push — keeps the connect request fast).
 * Merge rules are shared with the manual two-way sync; local wins on conflict.
 */
export async function importSimklWatched(
  username: string,
  clientId: string,
  tokens: UserSimklTokens,
) {
  try {
    await runSimklTwoWaySync(username, clientId, tokens, { push: false });
  } catch (e) {
    console.warn('Simkl watched pull failed — connect still succeeds', e);
  }
}
