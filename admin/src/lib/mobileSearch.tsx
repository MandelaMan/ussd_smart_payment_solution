import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type MobileSearchContextValue = {
  searchOpen: boolean;
  searchValue: string;
  setSearchOpen: (open: boolean) => void;
  setSearchValue: (value: string) => void;
  /** Close search mode and clear the query. */
  closeSearch: () => void;
  /** Register the active search field value from MobilePageChrome. */
  bindSearchValue: (value: string) => void;
};

const MobileSearchContext = createContext<MobileSearchContextValue | null>(null);

export function MobileSearchProvider({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  const value = useMemo<MobileSearchContextValue>(
    () => ({
      searchOpen,
      searchValue,
      setSearchOpen,
      setSearchValue,
      closeSearch: () => {
        setSearchOpen(false);
        setSearchValue("");
      },
      bindSearchValue: setSearchValue,
    }),
    [searchOpen, searchValue]
  );

  return (
    <MobileSearchContext.Provider value={value}>{children}</MobileSearchContext.Provider>
  );
}

export function useMobileSearch() {
  const ctx = useContext(MobileSearchContext);
  if (!ctx) {
    throw new Error("useMobileSearch must be used within MobileSearchProvider");
  }
  return ctx;
}

export function useMobileSearchOptional() {
  return useContext(MobileSearchContext);
}
