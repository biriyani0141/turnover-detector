"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

type HeaderValue = {
  date?: string;
  count?: string;
  dateSelector?: {
    availableDates: string[];
    selectedDate: string | null;
    onChange: (date: string | null) => void;
  };
  descToggle?: {
    open: boolean;
    onToggle: () => void;
    description: string;
  };
};

const HeaderValueContext = createContext<HeaderValue>({});
const SetHeaderValueContext = createContext<(value: HeaderValue) => void>(() => {});

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<HeaderValue>({});
  return (
    <SetHeaderValueContext.Provider value={setValue}>
      <HeaderValueContext.Provider value={value}>{children}</HeaderValueContext.Provider>
    </SetHeaderValueContext.Provider>
  );
}

/** 各ページがmount時にdate/countをセットするためのフック */
export function useHeader() {
  return useContext(SetHeaderValueContext);
}

/** CommonHeaderが現在のdate/countを読むためのフック */
export function useHeaderValue() {
  return useContext(HeaderValueContext);
}
