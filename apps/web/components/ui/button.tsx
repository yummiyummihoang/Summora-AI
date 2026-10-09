import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2", {
  variants: {
    variant: { default: "bg-zinc-950 text-white shadow-sm hover:bg-zinc-800", secondary: "border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50", ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900", destructive: "bg-zinc-800 text-white hover:bg-zinc-700" },
    size: { default: "h-10 px-4", sm: "h-8 px-3 text-xs", icon: "size-9" },
  }, defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
