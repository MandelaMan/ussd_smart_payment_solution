import {
  useCallback,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

/** High enough to clear ModalShell (2000) and nested AppDialog (~2050). */
export const FLOATING_MENU_Z_INDEX = 10000;

const MENU_MAX_HEIGHT = 280;
const MENU_GAP = 4;

export type FloatingMenuPlacement = {
  top: number;
  /** Distance from the viewport bottom; used when opening above the trigger. */
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "bottom" | "top";
};

export function computeFloatingMenuPlacement(
  trigger: DOMRect,
  maxHeight = MENU_MAX_HEIGHT
): FloatingMenuPlacement {
  const viewportH = window.innerHeight;
  const spaceBelow = viewportH - trigger.bottom - MENU_GAP;
  const spaceAbove = trigger.top - MENU_GAP;
  const preferTop = spaceBelow < 160 && spaceAbove > spaceBelow;
  const available = preferTop ? spaceAbove : spaceBelow;
  const height = Math.max(120, Math.min(maxHeight, available));

  if (preferTop) {
    return {
      // Keep `top` as the highest allowed edge so callers can clamp overflow.
      top: Math.max(MENU_GAP, trigger.top - MENU_GAP - height),
      // Anchor the *bottom* of the menu to the trigger so short content
      // (e.g. an empty notifications panel) stays attached instead of
      // floating `maxHeight` pixels above the button.
      bottom: viewportH - trigger.top + MENU_GAP,
      left: trigger.left,
      width: trigger.width,
      maxHeight: height,
      placement: "top",
    };
  }

  return {
    top: trigger.bottom + MENU_GAP,
    left: trigger.left,
    width: trigger.width,
    maxHeight: height,
    placement: "bottom",
  };
}

/**
 * Keep a floating menu’s viewport position in sync while open.
 * Always portals to document.body so overflow:hidden ancestors cannot clip it.
 */
export function useFloatingMenuPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  maxHeight = MENU_MAX_HEIGHT
) {
  const [placement, setPlacement] = useState<FloatingMenuPlacement | null>(null);

  const update = useCallback(() => {
    if (!triggerRef.current) return;
    setPlacement(
      computeFloatingMenuPlacement(
        triggerRef.current.getBoundingClientRect(),
        maxHeight
      )
    );
  }, [triggerRef, maxHeight]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    update();
    const onScrollOrResize = () => update();
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, update]);

  return placement;
}

export function renderFloatingMenuPortal(
  placement: FloatingMenuPlacement | null,
  children: ReactNode,
  zIndex: number = FLOATING_MENU_Z_INDEX
) {
  if (!placement || typeof document === "undefined") return null;

  const anchoredAbove =
    placement.placement === "top" && placement.bottom != null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        ...(anchoredAbove
          ? { bottom: placement.bottom, top: "auto" }
          : { top: placement.top }),
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
        zIndex,
        // Avoid inheriting modal overflow / transform clipping quirks.
        pointerEvents: "auto",
      }}
    >
      {children}
    </div>,
    document.body
  );
}
