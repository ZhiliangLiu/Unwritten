import type { WorkAnchors } from '@unwritten/contracts';

export type DraftContent = { background: string; anchors: WorkAnchors };

export function sameDraft(left: DraftContent, right: DraftContent): boolean {
  return (
    left.background === right.background &&
    left.anchors.narrationDirective === right.anchors.narrationDirective &&
    left.anchors.contentPolicy === right.anchors.contentPolicy &&
    left.anchors.improvisationScope === right.anchors.improvisationScope
  );
}
