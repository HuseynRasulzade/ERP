import { NIGHT_WINDOW_END_HOUR, NIGHT_WINDOW_START_HOUR } from './time-codes';

/**
 * Night-hours interval-intersection arithmetic (docx spec Phase 18
 * sections 42-43). The night window is fixed at 22:00-06:00 (disclosed
 * simplification — spec allows it to be configurable per tenant/policy;
 * this build hardcodes the one instance). Handles a shift crossing
 * midnight by intersecting against the night window instance anchored to
 * the shift's own start date.
 */
export function computeNightOverlapMinutes(
  startTime: Date,
  endTime: Date,
): number {
  if (endTime <= startTime) return 0;
  const dayStart = new Date(
    Date.UTC(
      startTime.getUTCFullYear(),
      startTime.getUTCMonth(),
      startTime.getUTCDate(),
    ),
  );
  const nightStart = new Date(
    dayStart.getTime() + NIGHT_WINDOW_START_HOUR * 3_600_000,
  );
  const nightEnd = new Date(
    dayStart.getTime() + (24 + NIGHT_WINDOW_END_HOUR) * 3_600_000,
  );

  const overlapStart = Math.max(startTime.getTime(), nightStart.getTime());
  const overlapEnd = Math.min(endTime.getTime(), nightEnd.getTime());
  const primaryOverlapMinutes = Math.max(
    0,
    (overlapEnd - overlapStart) / 60_000,
  );

  // Also check the PREVIOUS day's night window (22:00 D-1 -> 06:00 D), in
  // case the shift started before dawn (e.g. 02:00-10:00 overlapping the
  // tail of the prior night).
  const prevNightStart = new Date(nightStart.getTime() - 24 * 3_600_000);
  const prevNightEnd = new Date(nightEnd.getTime() - 24 * 3_600_000);
  const prevOverlapStart = Math.max(
    startTime.getTime(),
    prevNightStart.getTime(),
  );
  const prevOverlapEnd = Math.min(endTime.getTime(), prevNightEnd.getTime());
  const prevOverlapMinutes = Math.max(
    0,
    (prevOverlapEnd - prevOverlapStart) / 60_000,
  );

  return Math.round(primaryOverlapMinutes + prevOverlapMinutes);
}
