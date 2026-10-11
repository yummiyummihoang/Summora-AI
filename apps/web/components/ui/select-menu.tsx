"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function SelectMenu({
  value,
  onValueChange,
  placeholder,
  items,
  "aria-label": ariaLabel,
  className,
}: {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  items: Array<{ value: string; label: string; disabled?: boolean }>;
  "aria-label": string;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-10 w-full min-w-0 items-center justify-between gap-2 overflow-hidden whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <SelectPrimitive.Value
          className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          placeholder={placeholder}
        />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={15} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          align="start"
          className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <SelectPrimitive.Viewport className="max-h-[var(--radix-select-content-available-height)]">
            {items.map((item) => (
              <SelectPrimitive.Item
                key={item.value}
                value={item.value}
                disabled={item.disabled}
                className="relative flex min-h-9 cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <SelectPrimitive.ItemText>{item.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
                  <Check className="size-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
