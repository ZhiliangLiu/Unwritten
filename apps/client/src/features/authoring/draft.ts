import type { WorkAnchors, WorkSettings } from '@unwritten/contracts';

export type DraftContent = { background: string; anchors: WorkAnchors; settings: WorkSettings };

export function sameDraft(left: DraftContent, right: DraftContent): boolean {
  return (
    left.background === right.background &&
    left.anchors.narrationDirective === right.anchors.narrationDirective &&
    left.anchors.contentPolicy === right.anchors.contentPolicy &&
    left.anchors.improvisationScope === right.anchors.improvisationScope &&
    JSON.stringify(left.settings) === JSON.stringify(right.settings)
  );
}
