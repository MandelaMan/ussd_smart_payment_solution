import {
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  IconButton,
  Input,
  InputGroup,
  Text,
} from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { FiFilter, FiSearch, FiX } from "react-icons/fi";
import { Link } from "react-router-dom";
import { MobileFilterSheet } from "./MobileFilterSheet";
import { MOBILE_BOTTOM_NAV_H } from "../../lib/mobileNav";

export type MobileFilterChip = {
  key: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
};

type MobilePageChromeProps = {
  title: string;
  description?: string;
  chips?: MobileFilterChip[];
  chipsTrailing?: ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Advanced filters rendered in a bottom sheet on mobile. */
  filterContent?: ReactNode;
  activeFilterCount?: number;
  onClearFilters?: () => void;
  filterTitle?: string;
  headerActions?: ReactNode;
  desktopActions?: ReactNode;
  children?: ReactNode;
};

export function MobilePageChrome({
  title,
  description,
  chips,
  chipsTrailing,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search…",
  filterContent,
  activeFilterCount = 0,
  onClearFilters,
  filterTitle = "Filters",
  headerActions,
  desktopActions,
  children,
}: MobilePageChromeProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const hasSearch = searchValue !== undefined && onSearchChange !== undefined;
  const hasFilters = Boolean(filterContent);

  return (
    <Box mb={{ base: 3, lg: 0 }} minW={0} maxW="100%">
      <Box display={{ base: "block", lg: "none" }}>
        {searchOpen && hasSearch ? (
          <Flex align="center" gap={2} mb={3}>
            <InputGroup flex={1} startElement={<FiSearch size={16} />}>
              <Input
                size="md"
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                borderRadius="full"
                bg="gray.100"
                border="none"
                boxShadow="none"
                autoFocus
                _focusVisible={{
                  bg: "gray.100",
                  boxShadow: "0 0 0 2px var(--chakra-colors-brand-500)",
                }}
              />
            </InputGroup>
            <IconButton
              aria-label="Close search"
              variant="ghost"
              size="sm"
              borderRadius="full"
              onClick={() => setSearchOpen(false)}
            >
              <FiX />
            </IconButton>
          </Flex>
        ) : (
          <Flex align="center" justify="space-between" gap={3} mb={chips?.length || hasFilters ? 3 : 0}>
            <Heading
              size="2xl"
              fontWeight="bold"
              lineHeight="1.2"
              letterSpacing="-0.02em"
            >
              {title}
            </Heading>
            <Flex align="center" gap={1} flexShrink={0}>
              {headerActions}
              {hasFilters ? (
                <Box position="relative">
                  <IconButton
                    aria-label="Open filters"
                    variant="ghost"
                    size="md"
                    borderRadius="full"
                    bg={activeFilterCount > 0 ? "brand.50" : "gray.100"}
                    color={activeFilterCount > 0 ? "brand.700" : "gray.700"}
                    onClick={() => setFilterOpen(true)}
                    _hover={{ bg: activeFilterCount > 0 ? "brand.100" : "gray.200" }}
                  >
                    <FiFilter size={18} />
                  </IconButton>
                  {activeFilterCount > 0 ? (
                    <Badge
                      position="absolute"
                      top="-2px"
                      right="-2px"
                      colorPalette="brand"
                      borderRadius="full"
                      minW="18px"
                      h="18px"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      fontSize="2xs"
                      px={1}
                    >
                      {activeFilterCount}
                    </Badge>
                  ) : null}
                </Box>
              ) : null}
              {hasSearch ? (
                <IconButton
                  aria-label="Search"
                  variant="ghost"
                  size="md"
                  borderRadius="full"
                  bg={searchValue?.trim() ? "brand.50" : "gray.100"}
                  color={searchValue?.trim() ? "brand.700" : "gray.700"}
                  onClick={() => setSearchOpen(true)}
                  _hover={{ bg: searchValue?.trim() ? "brand.100" : "gray.200" }}
                >
                  <FiSearch size={18} />
                </IconButton>
              ) : null}
            </Flex>
          </Flex>
        )}

        {chips && chips.length > 0 && !searchOpen ? (
          <Flex align="center" gap={2} mx={-1}>
            <Flex
              flex={1}
              gap={2}
              overflowX="auto"
              py={0.5}
              px={1}
              css={{
                scrollbarWidth: "none",
                "&::-webkit-scrollbar": { display: "none" },
                WebkitOverflowScrolling: "touch",
              }}
            >
              {chips.map((chip) => (
                <Button
                  key={chip.key}
                  type="button"
                  flexShrink={0}
                  px={4}
                  py={1.5}
                  h="auto"
                  minH="32px"
                  borderRadius="full"
                  fontSize="sm"
                  fontWeight="semibold"
                  whiteSpace="nowrap"
                  lineHeight="1.25"
                  variant={chip.active ? "solid" : "subtle"}
                  colorPalette={chip.active ? "brand" : "gray"}
                  bg={chip.active ? "brand.600" : "gray.100"}
                  color={chip.active ? "white" : "gray.700"}
                  onClick={chip.onClick}
                  _hover={{
                    bg: chip.active ? "brand.700" : "gray.200",
                  }}
                >
                  {chip.label}
                </Button>
              ))}
            </Flex>
            {chipsTrailing ? <Box flexShrink={0}>{chipsTrailing}</Box> : null}
          </Flex>
        ) : null}

        {hasFilters ? (
          <MobileFilterSheet
            open={filterOpen}
            onClose={() => setFilterOpen(false)}
            title={filterTitle}
            onClear={onClearFilters}
          >
            {filterContent}
          </MobileFilterSheet>
        ) : null}
      </Box>

      <Flex
        display={{ base: "none", lg: "flex" }}
        justify="space-between"
        align="center"
        gap={2}
        mb={2}
      >
        <Box>
          <Heading size="lg">{title}</Heading>
          {description ? (
            <Text fontSize="sm" color="gray.500" mt={0.5}>
              {description}
            </Text>
          ) : null}
        </Box>
        {desktopActions ?? headerActions}
      </Flex>

      {children}
    </Box>
  );
}

/** Fixed circular FAB — primary create action on mobile list pages. */
export function MobileFAB({
  children,
  onClick,
  to,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  to?: string;
  "aria-label"?: string;
}) {
  const shared = {
    position: "fixed" as const,
    bottom: `calc(${MOBILE_BOTTOM_NAV_H} + 12px + env(safe-area-inset-bottom, 0px))`,
    right: 4,
    zIndex: 25,
    display: { base: "flex", lg: "none" } as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    w: "56px",
    h: "56px",
    minW: "56px",
    minH: "56px",
    borderRadius: "full",
    bg: "brand.600",
    color: "white",
    boxShadow: "0 4px 20px rgba(22, 106, 130, 0.45)",
    fontSize: "xl",
    p: 0,
  };

  if (to) {
    return (
      <IconButton
        asChild
        aria-label={ariaLabel}
        {...shared}
        _hover={{ bg: "brand.700", transform: "scale(1.04)" }}
        _active={{ transform: "scale(0.96)" }}
      >
        <Link to={to}>{children}</Link>
      </IconButton>
    );
  }

  return (
    <IconButton
      aria-label={ariaLabel}
      onClick={onClick}
      {...shared}
      _hover={{ bg: "brand.700", transform: "scale(1.04)" }}
      _active={{ transform: "scale(0.96)" }}
    >
      {children}
    </IconButton>
  );
}
