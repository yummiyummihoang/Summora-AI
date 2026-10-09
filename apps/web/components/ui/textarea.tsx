import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn("min-h-32 w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400 focus-visible:border-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-200", className)} {...props} />,
);
Textarea.displayName = "Textarea";
