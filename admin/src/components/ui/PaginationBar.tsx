import { Flex, Text, Button, Box, IconButton } from "@chakra-ui/react";
import {
  FiChevronLeft,
  FiChevronRight,
  FiChevronsLeft,
  FiChevronsRight,
} from "react-icons/fi";

const PAGE_SKIP = 3;

type Pagination = {
  page: number;
  limit: number;
  total: number;
  pages: number;
};

type Props = {
  pagination: Pagination;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  pageSkip?: number;
};

function clampPage(page: number, pages: number) {
  return Math.max(1, Math.min(page, pages));
}

export function PaginationBar({
  pagination,
  onPageChange,
  itemLabel = "items",
  pageSkip = PAGE_SKIP,
}: Props) {
  const { page, limit, total, pages } = pagination;
  if (total === 0) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const prevSkipPage = clampPage(page - pageSkip, pages);
  const nextSkipPage = clampPage(page + pageSkip, pages);
  const canSkipBack = page > 1 && prevSkipPage < page;
  const canSkipForward = page < pages && nextSkipPage > page;

  const controlProps = {
    size: "sm" as const,
    variant: "outline" as const,
    colorPalette: "brand" as const,
    minH: "44px",
  };

  return (
    <Flex
      justify="space-between"
      align="center"
      direction={{ base: "column", sm: "row" }}
      gap={3}
      px={{ base: 3, md: 4 }}
      py={3}
      borderTop="1px solid"
      borderColor="gray.100"
      bg="gray.50"
      borderBottomRadius="sm"
    >
      <Text fontSize="sm" color="gray.600" textAlign={{ base: "center", sm: "left" }}>
        {from}–{to} of {total} {itemLabel}
      </Text>

      <Flex
        gap={1}
        align="center"
        w={{ base: "full", sm: "auto" }}
        justify={{ base: "center", sm: "flex-end" }}
        flexWrap="wrap"
      >
        {pages > 1 ? (
          <>
            <IconButton
              {...controlProps}
              aria-label={`Back ${pageSkip} pages`}
              title={`Back ${pageSkip} pages`}
              disabled={!canSkipBack}
              onClick={() => onPageChange(prevSkipPage)}
            >
              <FiChevronsLeft />
            </IconButton>

            <Button
              {...controlProps}
              disabled={page <= 1}
              px={{ base: 2, sm: 3 }}
              onClick={() => onPageChange(page - 1)}
            >
              <FiChevronLeft />
              <Box as="span" display={{ base: "none", md: "inline" }}>
                Previous
              </Box>
            </Button>

            <Text
              fontSize="sm"
              color="brand.700"
              fontWeight="medium"
              px={2}
              whiteSpace="nowrap"
              textAlign="center"
              minW={{ base: "4.5rem", sm: "auto" }}
            >
              {page} / {pages}
            </Text>

            <Button
              {...controlProps}
              disabled={page >= pages}
              px={{ base: 2, sm: 3 }}
              onClick={() => onPageChange(page + 1)}
            >
              <Box as="span" display={{ base: "none", md: "inline" }}>
                Next
              </Box>
              <FiChevronRight />
            </Button>

            <IconButton
              {...controlProps}
              aria-label={`Forward ${pageSkip} pages`}
              title={`Forward ${pageSkip} pages`}
              disabled={!canSkipForward}
              onClick={() => onPageChange(nextSkipPage)}
            >
              <FiChevronsRight />
            </IconButton>
          </>
        ) : (
          <Text fontSize="sm" color="gray.500">
            Page 1
          </Text>
        )}
      </Flex>
    </Flex>
  );
}
