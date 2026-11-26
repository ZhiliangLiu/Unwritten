export function turnHeadingId(turnId: string): string {
  return `turn-${turnId}-heading`;
}

export function paragraphAnchorId(turnId: string, para: number): string {
  return `turn-${turnId}-para-${para}`;
}
