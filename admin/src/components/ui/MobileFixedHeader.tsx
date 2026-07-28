import { Box } from "@chakra-ui/react";
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

type Props = {
  children: ReactNode;
  /** Extra props applied to the fixed header shell (mobile only visually). */
  headerProps?: Record<string, unknown>;
};

/**
 * Mobile page chrome that stays pinned under the status bar.
 * Uses position:fixed (not sticky) because the app shell keeps overflow:hidden
 * ancestors that prevent sticky from working in mobile PWAs.
 */
export function MobileFixedHeader({ children, headerProps }: Props) {
  const headerRef = useRef<HTMLDivElement>(null);
  const height = useHeaderHeight(headerRef);

  return (
    <>
      <Box
        ref={headerRef}
        className="mobile-page-header"
        {...headerProps}
        display={{ base: "block", lg: "none" }}
      >
        {children}
      </Box>
      <Box
        display={{ base: "block", lg: "none" }}
        h={`${height}px`}
        flexShrink={0}
        aria-hidden
      />
    </>
  );
}

function useHeaderHeight(ref: RefObject<HTMLDivElement | null>) {
  const [height, setHeight] = useState(72);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      setHeight(Math.ceil(el.getBoundingClientRect().height));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref]);

  return height;
}
