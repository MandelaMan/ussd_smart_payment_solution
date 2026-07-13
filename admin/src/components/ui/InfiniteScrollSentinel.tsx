import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import { useEffect, useRef } from "react";

type Props = {
  hasMore: boolean;
  loading?: boolean;
  onLoadMore: () => void;
  itemLabel?: string;
  total?: number;
  loadedCount?: number;
};

/** Intersection observer footer that loads the next page near the bottom of the scroll root. */
export function InfiniteScrollSentinel({
  hasMore,
  loading = false,
  onLoadMore,
  itemLabel = "items",
  total,
  loadedCount,
}: Props) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(loading);
  const hasMoreRef = useRef(hasMore);
  const onLoadMoreRef = useRef(onLoadMore);

  loadingRef.current = loading;
  hasMoreRef.current = hasMore;
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const root = document.querySelector<HTMLElement>("[data-app-scroll-root]");
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (!hasMoreRef.current || loadingRef.current) return;
        onLoadMoreRef.current();
      },
      {
        root: root ?? null,
        rootMargin: "240px 0px",
        threshold: 0,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!hasMore && !loading && (total == null || loadedCount == null)) {
    return null;
  }

  return (
    <Box
      px={4}
      py={4}
      borderTop="1px solid"
      borderColor="border.muted"
      bg="bg.subtle"
      display={{ base: "block", lg: "none" }}
    >
      <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
      <Flex justify="center" align="center" gap={2} minH="44px">
        {loading ? (
          <>
            <Spinner size="sm" color="brand.600" />
            <Text fontSize="sm" color="fg.muted">
              Loading more…
            </Text>
          </>
        ) : hasMore ? (
          <Text fontSize="sm" color="fg.subtle">
            Scroll for more
          </Text>
        ) : total != null && loadedCount != null ? (
          <Text fontSize="sm" color="fg.muted">
            {loadedCount} of {total} {itemLabel}
          </Text>
        ) : null}
      </Flex>
    </Box>
  );
}
