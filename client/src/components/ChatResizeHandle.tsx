import type { KeyboardEvent, PointerEvent } from 'react';

interface ChatResizeHandleProps {
  height: number | null;
  min: number;
  max: number;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}

export default function ChatResizeHandle({
  height, min, max, onPointerDown, onPointerMove, onPointerUp, onKeyDown,
}: ChatResizeHandleProps) {
  return (
    <div
      className="chat-resize-handle"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the chat and message input areas"
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuenow={height != null ? Math.round(height) : undefined}
      aria-valuetext={height != null ? `${Math.round(height)} pixels` : 'Default size'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span className="chat-resize-handle-grip" aria-hidden="true" />
    </div>
  );
}
