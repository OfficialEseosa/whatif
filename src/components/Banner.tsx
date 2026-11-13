"use client";
import { useStore } from "@/lib/store";

export function Banner() {
  const error = useStore((s) => s.error);
  return (
    <>
      <h1 className="brand surface">
        WhatIf <span className="brand-city">ATL</span>
      </h1>
      {error && (
        <p className="toast surface" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
