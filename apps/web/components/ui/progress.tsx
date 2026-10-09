"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  const progress = Math.min(100, Math.max(0, value));

  return (
    <ProgressPrimitive.Root
      value={progress}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
      aria-label="Tiến độ tóm tắt"
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - progress}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
