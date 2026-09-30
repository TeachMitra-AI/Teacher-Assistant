import { useEffect, type RefObject } from 'react';

type DismissableRef = RefObject<HTMLElement | null>;

// Closes an open popover/menu on an outside click or Escape (profile menu, "+ More Context"). Pass an array of refs when the
// content spans several DOM subtrees (e.g. a trigger plus a portaled panel); a click is "outside" only if it misses all of them.
export function useDismissable(open: boolean, ref: DismissableRef | DismissableRef[], onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const refs = Array.isArray(ref) ? ref : [ref];
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      const isInside = refs.some((r) => r.current?.contains(target));
      if (!isInside) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref, onClose]);
}
