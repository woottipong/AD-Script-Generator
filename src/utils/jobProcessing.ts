import type { AnalysisBatch, PersistedJobState } from '../types/ad';

export function completedAnalysisSpotIds(batches: readonly AnalysisBatch[]): Set<string> {
  return new Set(batches.filter((batch) => batch.status === 'completed')
    .flatMap((batch) => batch.candidate_spots.map((spot) => spot.spot_id)));
}

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
