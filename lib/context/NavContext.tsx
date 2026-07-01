"use client";

import { createContext, useContext, useState } from "react";

interface NavContextValue {
  navHidden: boolean;
  setNavHidden: (hidden: boolean) => void;
}

const NavContext = createContext<NavContextValue>({
  navHidden: false,
  setNavHidden: () => {},
});

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [navHidden, setNavHidden] = useState(false);
  return (
    <NavContext.Provider value={{ navHidden, setNavHidden }}>
      {children}
    </NavContext.Provider>
  );
}

export function useNav() {
  return useContext(NavContext);
}
