import { useEffect, type RefObject } from 'react';

type DismissableRef = RefObject<HTMLElement | null>;

// Closes an open popover/menu on an outside click or Escape — shared by the
// profile menu and the "+ More Context" popover. Pass an array of refs when
// the open content spans more than one DOM subtree (e.g. a trigger plus a
// portaled panel that isn't a DOM descendant of it) — a click only counts
// as "outside" if it lands outside all of them.
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
