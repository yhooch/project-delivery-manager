export const TAG_COLOR_FALLBACK_KEY = "gray";

export const TAG_COLOR_CLASS_NAMES = {
  gray: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/70 dark:bg-red-950/45 dark:text-red-200",
  orange:
    "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/45 dark:text-orange-200",
  amber:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/45 dark:text-amber-200",
  yellow:
    "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900/70 dark:bg-yellow-950/45 dark:text-yellow-200",
  green:
    "border-green-200 bg-green-50 text-green-700 dark:border-green-900/70 dark:bg-green-950/45 dark:text-green-200",
  teal: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900/70 dark:bg-teal-950/45 dark:text-teal-200",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/70 dark:bg-cyan-950/45 dark:text-cyan-200",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/70 dark:bg-blue-950/45 dark:text-blue-200",
  indigo:
    "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/70 dark:bg-indigo-950/45 dark:text-indigo-200",
  violet:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/70 dark:bg-violet-950/45 dark:text-violet-200",
  purple:
    "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/70 dark:bg-purple-950/45 dark:text-purple-200",
  pink: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900/70 dark:bg-pink-950/45 dark:text-pink-200",
  rose: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/45 dark:text-rose-200",
  primary:
    "border-transparent bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary",
  info: "border-transparent bg-info/15 text-info dark:bg-info/20 dark:text-info",
  success:
    "border-transparent bg-success/15 text-success dark:bg-success/20 dark:text-success",
  warning:
    "border-transparent bg-warning/15 text-warning dark:bg-warning/20 dark:text-warning",
  destructive:
    "border-transparent bg-destructive/15 text-destructive dark:bg-destructive/20 dark:text-destructive",
} as const;

export type TagColorKey = keyof typeof TAG_COLOR_CLASS_NAMES;

export function getTagColorClassName(colorKey: string | undefined): string {
  if (colorKey && colorKey in TAG_COLOR_CLASS_NAMES) {
    return TAG_COLOR_CLASS_NAMES[colorKey as TagColorKey];
  }

  return TAG_COLOR_CLASS_NAMES[TAG_COLOR_FALLBACK_KEY];
}
