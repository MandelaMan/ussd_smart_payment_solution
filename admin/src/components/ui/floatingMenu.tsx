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
      top: Math.max(MENU_GAP, trigger.top - MENU_GAP - height),
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

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: placement.top,
        left: placement.left,
        width: placement.width,
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
