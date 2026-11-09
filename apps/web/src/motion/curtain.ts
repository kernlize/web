/*
 * The curtain is a panel between two edges, measured in screen widths from the left. Both edges wait off the
 * right of the screen; the leading one crosses to cover the old page, the trailing one follows to uncover the
 * new one. The margins clear the bow the stage draws into each edge.
 */
export const PARKED = 1.2;
export const CROSSED = -0.08;

/** Seconds the curtain takes to cover the old page, and to leave the new one. */
export const COVER_SECONDS = 0.5;
export const UNCOVER_SECONDS = 0.75;
