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
import { useEffect, useState } from "react";
import { FiArrowLeft, FiChevronDown, FiSearch } from "react-icons/fi";
import { HiOutlineSortDescending } from "react-icons/hi";
import { Link } from "react-router-dom";
import { useMobileSearchOptional } from "../../lib/mobileSearch";
import { MOBILE_BOTTOM_NAV_OFFSET } from "../../lib/mobileNav";
import { scrollAppToTop } from "../ScrollToTop";
import { MobileFixedHeader } from "./MobileFixedHeader";
import { mobileStickyHeaderProps } from "./pageLayout";
import { MobileFilterSheet } from "./MobileFilterSheet";

export type MobileFilterChip = {
  key: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
};

export type MobileSortOption = {
  key: string;
  label: string;
  active?: boolean;
  direction?: "asc" | "desc";
  onClick: () => void;
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
  /** Sort options shown in a bottom sheet from the chips-row sort control. */
  sortOptions?: MobileSortOption[];
  sortTitle?: string;
  headerActions?: ReactNode;
  desktopActions?: ReactNode;
  children?: ReactNode;
};

const iconBtnBase = {
  variant: "ghost" as const,
  size: "md" as const,
  minW: "40px",
  h: "40px",
  borderRadius: "full",
  flexShrink: 0,
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
  sortOptions,
  sortTitle = "Sort by",
  headerActions,
  desktopActions,
  children,
}: MobilePageChromeProps) {
  const mobileSearch = useMobileSearchOptional();
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const hasSearch = searchValue !== undefined && onSearchChange !== undefined;
  const hasFilters = Boolean(filterContent);
  const hasSort = Boolean(sortOptions && sortOptions.length > 0);
  const hasChipRow =
    (chips && chips.length > 0) || hasFilters || hasSort || Boolean(chipsTrailing);
  const searchOpen = Boolean(hasSearch && mobileSearch?.searchOpen);
  const activeSort = sortOptions?.find((option) => option.active);

  useEffect(() => {
    if (!mobileSearch || !hasSearch) return;
    mobileSearch.bindSearchValue(searchValue ?? "");
  }, [mobileSearch, hasSearch, searchValue]);

  useEffect(() => {
    if (!searchOpen) return;
    const main = document.querySelector<HTMLElement>("[data-app-scroll-root]");
    if (main) {
      main.scrollTo({ top: 0, left: 0, behavior: "auto" });
      main.scrollTop = 0;
    }
  }, [searchOpen]);

  function openSearch() {
    mobileSearch?.setSearchOpen(true);
  }

  function closeSearch() {
    onSearchChange?.("");
    mobileSearch?.closeSearch();
  }

  return (
    <Box mb={{ base: 0, lg: 0 }} minW={0} maxW="100%">
      <MobileFixedHeader
        headerProps={{
          ...mobileStickyHeaderProps,
          bg: "bg.panel",
          pb: hasChipRow && !searchOpen ? 3 : 2.5,
        }}
      >
        {searchOpen && hasSearch ? (
          <Flex align="center" gap={2} py={1}>
            <IconButton
              aria-label="Back"
              {...iconBtnBase}
              onClick={closeSearch}
            >
              <FiArrowLeft size={20} />
            </IconButton>
            <InputGroup flex={1} startElement={<FiSearch size={16} />}>
              <Input
                size="md"
                h="44px"
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                borderRadius="full"
                bg="bg.muted"
                border="none"
                boxShadow="none"
                autoFocus
                _focusVisible={{
                  bg: "bg.panel",
                  border: "1px solid",
                  borderColor: "brand.500",
                  boxShadow: "none",
                  outline: "none",
                }}
              />
            </InputGroup>
          </Flex>
        ) : (
          <>
            <Flex align="center" justify="space-between" gap={3} minH="44px">
              <Heading
                size="2xl"
                fontWeight="bold"
                lineHeight="1.15"
                letterSpacing="-0.03em"
                color="fg"
                truncate
              >
                {title}
              </Heading>
              <Flex align="center" gap={1} flexShrink={0}>
                {headerActions}
                {hasSearch ? (
                  <IconButton
                    aria-label="Search"
                    {...iconBtnBase}
                    bg={searchValue?.trim() ? "brand.50" : "gray.100"}
                    color={searchValue?.trim() ? "brand.700" : "gray.700"}
                    onClick={openSearch}
                    _hover={{ bg: searchValue?.trim() ? "brand.100" : "gray.200" }}
                  >
                    <FiSearch size={18} />
                  </IconButton>
                ) : null}
              </Flex>
            </Flex>

            {hasChipRow ? (
              <Flex align="center" gap={2} mt={3} minW={0}>
                {chips && chips.length > 0 ? (
                  <Flex
                    flex={1}
                    gap={2}
                    overflowX="auto"
                    py={0.5}
                    minW={0}
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
                        minH="34px"
                        borderRadius="full"
                        fontSize="sm"
                        fontWeight="semibold"
                        whiteSpace="nowrap"
                        lineHeight="1.25"
                        variant={chip.active ? "solid" : "subtle"}
                        colorPalette={chip.active ? "brand" : "gray"}
                        bg={chip.active ? "brand.600" : "gray.100"}
                        color={chip.active ? "white" : "gray.700"}
                        onClick={() => {
                          chip.onClick?.();
                          scrollAppToTop();
                          requestAnimationFrame(() => scrollAppToTop());
                        }}
                        _hover={{
                          bg: chip.active ? "brand.700" : "gray.200",
                        }}
                      >
                        {chip.label}
                      </Button>
                    ))}
                  </Flex>
                ) : (
                  <Box flex={1} />
                )}

                {hasFilters ? (
                  <Box position="relative" flexShrink={0}>
                    <IconButton
                      aria-label="More filters"
                      {...iconBtnBase}
                      minW="34px"
                      h="34px"
                      bg={activeFilterCount > 0 ? "brand.50" : "gray.100"}
                      color={activeFilterCount > 0 ? "brand.700" : "gray.700"}
                      onClick={() => setFilterOpen(true)}
                      _hover={{ bg: activeFilterCount > 0 ? "brand.100" : "gray.200" }}
                    >
                      <FiChevronDown size={18} />
                    </IconButton>
                    {activeFilterCount > 0 ? (
                      <Badge
                        position="absolute"
                        top="-2px"
                        right="-2px"
                        colorPalette="brand"
                        borderRadius="full"
                        minW="16px"
                        h="16px"
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

                {hasSort ? (
                  <IconButton
                    aria-label={
                      activeSort
                        ? `Sort by ${activeSort.label}${activeSort.direction ? `, ${activeSort.direction}` : ""}`
                        : "Sort"
                    }
                    {...iconBtnBase}
                    minW="34px"
                    h="34px"
                    bg={activeSort ? "brand.50" : "transparent"}
                    color={activeSort ? "brand.700" : "gray.700"}
                    onClick={() => setSortOpen(true)}
                    _hover={{ bg: "bg.muted" }}
                  >
                    <HiOutlineSortDescending size={20} />
                  </IconButton>
                ) : null}

                {chipsTrailing ? <Box flexShrink={0}>{chipsTrailing}</Box> : null}
              </Flex>
            ) : null}
          </>
        )}
      </MobileFixedHeader>

      {hasFilters && !searchOpen ? (
        <MobileFilterSheet
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          title={filterTitle}
          onClear={onClearFilters}
        >
          {filterContent}
        </MobileFilterSheet>
      ) : null}

      {hasSort && !searchOpen ? (
        <MobileFilterSheet
          open={sortOpen}
          onClose={() => setSortOpen(false)}
          title={sortTitle}
          clearLabel="Done"
          onClear={() => setSortOpen(false)}
        >
          <Flex direction="column" gap={2}>
            {sortOptions!.map((option) => (
              <Button
                key={option.key}
                type="button"
                variant={option.active ? "solid" : "outline"}
                colorPalette={option.active ? "brand" : "gray"}
                justifyContent="space-between"
                borderRadius="lg"
                h="48px"
                px={4}
                onClick={() => {
                  option.onClick();
                  setSortOpen(false);
                  scrollAppToTop();
                  requestAnimationFrame(() => scrollAppToTop());
                }}
              >
                <Text fontWeight="semibold">{option.label}</Text>
                {option.active && option.direction ? (
                  <Text fontSize="xs" opacity={0.85} textTransform="uppercase">
                    {option.direction}
                  </Text>
                ) : null}
              </Button>
            ))}
          </Flex>
        </MobileFilterSheet>
      ) : null}

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
            <Text fontSize="sm" color="fg.muted" mt={0.5}>
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
  const mobileSearch = useMobileSearchOptional();
  if (mobileSearch?.searchOpen) return null;

  const shared = {
    position: "fixed" as const,
    bottom: MOBILE_BOTTOM_NAV_OFFSET,
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
