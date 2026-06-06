"use client";

import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface AnimatedCheckboxProps {
  title?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  strikeThroughWhenChecked?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  error?: boolean;
  className?: string;
  onCheckedChange?: (checked: boolean) => void;
}

const springTransition = {
  type: "spring" as const,
  duration: 0.4,
  bounce: 0.2,
};

export function AnimatedCheckbox({
  title = "Implement Checkbox",
  defaultChecked = false,
  checked: controlledChecked,
  strikeThroughWhenChecked = true,
  readOnly = false,
  loading = false,
  error = false,
  className,
  onCheckedChange,
}: AnimatedCheckboxProps) {
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const isControlled = controlledChecked !== undefined;
  const checked = isControlled ? controlledChecked : internalChecked;

  useEffect(() => {
    if (isControlled) return;
    setInternalChecked(defaultChecked);
  }, [defaultChecked, isControlled]);

  const handleClick = () => {
    if (readOnly || loading) return;
    const newChecked = !checked;
    if (!isControlled) setInternalChecked(newChecked);
    onCheckedChange?.(newChecked);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 select-none",
        readOnly || loading ? "cursor-default" : "cursor-pointer",
        className,
      )}
      onClick={handleClick}
    >
      <div
        className={cn(
          "size-4.5 flex items-center justify-center border-[1.5px] transition-colors duration-200",
          error
            ? "border-destructive bg-destructive/10"
            : checked
              ? "bg-foreground border-transparent"
              : loading
                ? "border-primary/50 bg-primary-bright/20"
                : "bg-transparent border-muted-foreground/40 hover:border-muted-foreground/60",
        )}
      >
        {loading ? (
          <Loader2 size={10} className="animate-spin text-primary" />
        ) : (
          <svg viewBox="0 0 20 20" className="size-full text-background">
            <motion.path
              d="M 0 4.5 L 3.182 8 L 10 0"
              fill="transparent"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              transform="translate(5 6)"
              initial={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
              animate={{
                pathLength: checked ? 1 : 0,
                opacity: checked ? 1 : 0,
              }}
              transition={{
                pathLength: { ease: "easeOut", duration: 0.3 },
                opacity: { duration: 0 },
              }}
            />
          </svg>
        )}
      </div>
      <div className="relative min-w-0">
        <span
          className={cn(
            "text-sm font-medium transition-colors duration-200",
            checked && strikeThroughWhenChecked ? "text-muted-foreground" : "text-foreground",
            error && "text-destructive",
          )}
        >
          {title}
        </span>
        {strikeThroughWhenChecked && (
          <motion.div
            className="absolute left-0 top-1/2 h-[1.5px] bg-muted-foreground -translate-y-1/2"
            initial={{ width: checked ? "100%" : 0, opacity: checked ? 1 : 0 }}
            animate={{
              width: checked ? "100%" : 0,
              opacity: checked ? 1 : 0,
            }}
            transition={springTransition}
          />
        )}
      </div>
    </div>
  );
}
