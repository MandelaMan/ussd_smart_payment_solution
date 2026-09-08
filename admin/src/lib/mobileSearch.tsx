import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type MobileSearchOpenValue = {
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  closeSearch: () => void;
};

type MobileSearchQueryValue = {
  searchValue: string;
  setSearchValue: (value: string) => void;
  bindSearchValue: (value: string) => void;
};

type MobileSearchContextValue = MobileSearchOpenValue & MobileSearchQueryValue;

const MobileSearchOpenContext = createContext<MobileSearchOpenValue | null>(null);
const MobileSearchQueryContext = createContext<MobileSearchQueryValue | null>(null);

export function MobileSearchProvider({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const openValue = useMemo<MobileSearchOpenValue>(
    () => ({
      searchOpen,
      setSearchOpen,
      closeSearch: () => {
        setSearchOpen(false);
        setSearchValue("");
      },
    }),
    [searchOpen]
  );

  const queryValue = useMemo<MobileSearchQueryValue>(
    () => ({
      searchValue,
      setSearchValue,
      bindSearchValue: setSearchValue,
    }),
    [searchValue]
  );

  return (
    <MobileSearchOpenContext.Provider value={openValue}>
      <MobileSearchQueryContext.Provider value={queryValue}>
        {children}
      </MobileSearchQueryContext.Provider>
    </MobileSearchOpenContext.Provider>
  );
}

function mergeSearchContext(
  open: MobileSearchOpenValue | null,
  query: MobileSearchQueryValue | null
): MobileSearchContextValue | null {
  if (!open || !query) return null;
  return { ...open, ...query };
}

export function useMobileSearch() {
  const ctx = mergeSearchContext(
    useContext(MobileSearchOpenContext),
    useContext(MobileSearchQueryContext)
  );
  if (!ctx) {
    throw new Error("useMobileSearch must be used within MobileSearchProvider");
  }
  return ctx;
}

export function useMobileSearchOptional() {
  return mergeSearchContext(
    useContext(MobileSearchOpenContext),
    useContext(MobileSearchQueryContext)
  );
}

/** Layout chrome: subscribe only to search-open, not each keystroke. */
export function useMobileSearchOpen() {
  return Boolean(useContext(MobileSearchOpenContext)?.searchOpen);
}

export function useMobileSearchClose() {
  return useContext(MobileSearchOpenContext)?.closeSearch;
}
