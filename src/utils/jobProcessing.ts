import type { PersistedJobState } from '../types/ad';

type SpotResult = { decision: 'generate' | 'skip'; text: string; reason?: string };

export function mergeProcessingState(
  processing: PersistedJobState,
  latest: PersistedJobState,
  results?: ReadonlyMap<string, SpotResult>,
): PersistedJobState {
  const spots = latest.spots.map((spot) => {
    const result = results?.get(spot.spot_id);
    if (!result) return spot;
    return {
      ...spot,
      start_ms: spot.original_start_ms,
      end_ms: spot.original_end_ms,
      duration_ms: spot.original_end_ms - spot.original_start_ms,
      decision: result.decision,
      text: result.text,
      reason: result.reason,
    };
  });
  return { ...processing, spots };
}
