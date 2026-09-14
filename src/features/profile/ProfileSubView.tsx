"use client";

import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface ProfileSubViewProps {
  title: string;
  onBack: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function ProfileSubView({
  title,
  onBack,
  children,
  footer,
}: ProfileSubViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-divider bg-background/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="rounded-full p-2 text-text-secondary transition-colors hover:bg-surface hover:text-text"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="text-base font-semibold text-text">{title}</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-28 md:px-8">
        <div className="mx-auto w-full max-w-lg md:max-w-none">{children}</div>
      </div>
      {footer ? (
        <div className="border-t border-divider bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-8">
          <div className="mx-auto w-full max-w-lg md:max-w-none">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}
