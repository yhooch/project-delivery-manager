"use client";

import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

type SelectMenuOption = {
  disabled: boolean;
  label: React.ReactNode;
  title?: string;
  value: string;
};

export type SelectMenuProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  containerClassName?: string;
  contentClassName?: string;
  "data-testid"?: string;
  menuAlign?: "start" | "center" | "end";
  triggerAriaLabel?: string;
  triggerAriaLabelledBy?: string;
  triggerId?: string;
  triggerTestId?: string;
};

export const SelectMenu = React.forwardRef<HTMLSelectElement, SelectMenuProps>(
  (
    {
      children,
      className,
      containerClassName,
      contentClassName,
      disabled,
      id,
      menuAlign = "start",
      onChange,
      triggerAriaLabel,
      triggerAriaLabelledBy,
      triggerId,
      triggerTestId,
      value,
      defaultValue,
      "aria-disabled": ariaDisabled,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      "data-testid": testId,
      ...props
    },
    ref,
  ) => {
    const options = React.useMemo(() => parseOptions(children), [children]);
    const isControlled = value !== undefined;
    const [internalValue, setInternalValue] = React.useState(
      String(defaultValue ?? options[0]?.value ?? ""),
    );
    const selectedValue = String(isControlled ? value : internalValue);
    const selectedOption =
      options.find((option) => option.value === selectedValue) ?? options[0];
    const selectRef = React.useRef<HTMLSelectElement | null>(null);
    const generatedLabelId = React.useId();
    const fieldLabelId = `${generatedLabelId}-field`;
    const selectedLabelId = `${generatedLabelId}-selected`;
    const [resolvedFieldLabel, setResolvedFieldLabel] = React.useState("");

    const shouldFillContainer =
      !className ||
      className.includes("w-full") ||
      className.includes("flex-1");

    const fieldLabel = ariaLabel ?? resolvedFieldLabel;
    const computedTriggerAriaLabelledBy =
      triggerAriaLabel || triggerAriaLabelledBy
        ? triggerAriaLabelledBy
        : ariaLabelledBy
          ? `${ariaLabelledBy} ${selectedLabelId}`
          : fieldLabel
            ? `${fieldLabelId} ${selectedLabelId}`
            : undefined;
    const shouldRenderInternalFieldLabel =
      !triggerAriaLabel &&
      !triggerAriaLabelledBy &&
      !ariaLabelledBy &&
      Boolean(fieldLabel);

    React.useImperativeHandle(
      ref,
      () => selectRef.current as HTMLSelectElement,
    );

    React.useEffect(() => {
      if (
        ariaLabel ||
        ariaLabelledBy ||
        triggerAriaLabel ||
        triggerAriaLabelledBy
      ) {
        setResolvedFieldLabel("");
        return;
      }

      const labels = selectRef.current?.labels;
      const nextFieldLabel = labels
        ? Array.from(labels).map(getLabelText).filter(Boolean).join(" ")
        : "";

      setResolvedFieldLabel(normalizeWhitespace(nextFieldLabel));
    }, [ariaLabel, ariaLabelledBy, triggerAriaLabel, triggerAriaLabelledBy]);

    function handleNativeChange(event: React.ChangeEvent<HTMLSelectElement>) {
      if (!isControlled) {
        setInternalValue(event.target.value);
      }
      onChange?.(event);
    }

    function handleMenuSelect(nextValue: string) {
      if (!isControlled) {
        setInternalValue(nextValue);
      }
      onChange?.({
        currentTarget: { value: nextValue },
        target: { value: nextValue },
      } as React.ChangeEvent<HTMLSelectElement>);
    }

    return (
      <span
        className={cn(
          "relative inline-flex min-w-0",
          shouldFillContainer && "w-full",
          containerClassName,
        )}
      >
        <select
          ref={selectRef}
          id={id}
          value={selectedValue}
          disabled={disabled}
          aria-disabled={disabled ? true : ariaDisabled}
          aria-hidden="true"
          data-testid={testId}
          tabIndex={-1}
          className="sr-only"
          onChange={handleNativeChange}
          {...props}
        >
          {options.map((option) => (
            <option
              key={option.value || "__empty"}
              value={option.value}
              disabled={option.disabled}
              title={option.title}
            >
              {option.label}
            </option>
          ))}
        </select>
        {shouldRenderInternalFieldLabel && (
          <span id={fieldLabelId} className="sr-only">
            {fieldLabel}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <button
              type="button"
              id={triggerId ?? (id ? `${id}-trigger` : undefined)}
              aria-disabled={disabled ? true : ariaDisabled}
              aria-label={triggerAriaLabel}
              aria-labelledby={computedTriggerAriaLabelledBy}
              data-testid={
                triggerTestId ?? (testId ? `${testId}-trigger` : undefined)
              }
              disabled={disabled}
              title={selectedOption?.title}
              className={cn(
                "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-left text-sm text-foreground shadow-sm transition-colors [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:py-2",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
                className,
                "pr-8",
              )}
            >
              <span id={selectedLabelId} className="min-w-0 flex-1 truncate">
                {renderDisplayLabel(selectedOption?.label)}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={menuAlign}
            className={cn(
              "max-h-[min(18rem,var(--radix-dropdown-menu-content-available-height))] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto",
              contentClassName,
            )}
          >
            {options.map((option) => (
              <DropdownMenuItem
                key={option.value || "__empty"}
                disabled={option.disabled}
                data-testid={
                  testId
                    ? `${testId}-option-${option.value || "empty"}`
                    : undefined
                }
                title={option.title}
                onSelect={() => handleMenuSelect(option.value)}
              >
                <Check
                  aria-hidden="true"
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    option.value === selectedValue
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">
                  {renderDisplayLabel(option.label)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    );
  },
);
SelectMenu.displayName = "SelectMenu";

function parseOptions(children: React.ReactNode): SelectMenuOption[] {
  return React.Children.toArray(children).flatMap((child, index) => {
    if (
      !React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement>>(
        child,
      )
    ) {
      return [];
    }
    const label = child.props.children;
    const fallbackValue =
      typeof label === "string" || typeof label === "number"
        ? String(label)
        : String(index);
    return [
      {
        disabled: Boolean(child.props.disabled),
        label,
        title: child.props.title,
        value: String(child.props.value ?? fallbackValue),
      },
    ];
  });
}

function renderDisplayLabel(label: React.ReactNode): React.ReactNode {
  return typeof label === "number" ? String(label) : label;
}

function getLabelText(label: HTMLLabelElement): string {
  const clone = label.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("button,input,meter,output,progress,select,textarea")
    .forEach((control) => control.remove());

  return normalizeWhitespace(clone.textContent ?? "");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
