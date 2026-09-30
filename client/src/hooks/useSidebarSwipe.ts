import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Mobile drawer swipe gestures for the chat-history sidebar. Threshold-based, not a live drag: a swipe that clears the
 * thresholds flips the sidebar open/closed like the tap handlers, and its CSS transition animates it. EDGE_ZONE_PX must
 * stay narrow, since a wider zone competes with normal horizontal interaction (see useEdgeSwipeToOpen).
 */
const EDGE_ZONE_PX = 24;
const MIN_SWIPE_DISTANCE_PX = 50;
const MAX_VERTICAL_DRIFT_PX = 60;

interface PointerSwipeOptions {
  /** Omit to listen on `window`; pass a ref to scope listening to one element. */
  ref?: RefObject<HTMLElement>;
  enabled: boolean;
  /** Swipe must start within EDGE_ZONE_PX of the left edge (the closed→open gesture). */
  edgeOnly: boolean;
  onSwipe: (deltaX: number) => void;
}

function usePointerSwipe({ ref, enabled, edgeOnly, onSwipe }: PointerSwipeOptions) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const el: HTMLElement | Window | null = ref ? ref.current : window;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    function onPointerDown(e: PointerEvent) {
      // Touch only; desktop mouse dragging must never toggle the drawer.
      if (e.pointerType !== 'touch') return;
      if (edgeOnly && e.clientX > EDGE_ZONE_PX) return;
      startX = e.clientX;
      startY = e.clientY;
      tracking = true;
    }

    function onPointerUp(e: PointerEvent) {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // A real vertical scroll normally ends in pointercancel (see onPointerCancel); this is the backstop for a
      // mostly-vertical drag that still ends in a pointerup.
      if (Math.abs(dy) > MAX_VERTICAL_DRIFT_PX) return;
      if (Math.abs(dx) < MIN_SWIPE_DISTANCE_PX) return;
      onSwipe(dx);
    }

    function onPointerCancel() {
      tracking = false;
    }

    el.addEventListener('pointerdown', onPointerDown as EventListener);
    el.addEventListener('pointerup', onPointerUp as EventListener);
    el.addEventListener('pointercancel', onPointerCancel as EventListener);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown as EventListener);
      el.removeEventListener('pointerup', onPointerUp as EventListener);
      el.removeEventListener('pointercancel', onPointerCancel as EventListener);
    };
  }, [ref, enabled, edgeOnly, onSwipe]);
}

/** Left edge → swipe right to open the closed sidebar. Listens on `window` (no hit-area element to intercept clicks/scrolls); a swipe outside EDGE_ZONE_PX is never tracked. */
export function useEdgeSwipeToOpen(enabled: boolean, onOpen: () => void) {
  usePointerSwipe({
    enabled,
    edgeOnly: true,
    onSwipe: (dx) => {
      if (dx > 0) onOpen();
    },
  });
}

/** Swipe right-to-left on the open drawer to close it. Scoped to the drawer so it doesn't compete with swipes elsewhere. */
export function useDrawerSwipeToClose(ref: RefObject<HTMLElement>, enabled: boolean, onClose: () => void) {
  usePointerSwipe({
    ref,
    enabled,
    edgeOnly: false,
    onSwipe: (dx) => {
      if (dx < 0) onClose();
    },
  });
}
