import { useState } from "react";
import type { KeyboardEvent } from "react";

export function useEnterToSubmit(onSubmit: () => void) {
  const [composing, setComposing] = useState(false);
  return {
    onCompositionStart: () => setComposing(true),
    onCompositionEnd: () => setComposing(false),
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (composing || event.nativeEvent.isComposing) return;
      event.preventDefault();
      onSubmit();
    },
  };
}
