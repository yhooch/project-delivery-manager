export const themeStorageKey = "theme";
export const themeMediaQuery = "(prefers-color-scheme: dark)";

export const themeInitScript = `
(function () {
  try {
    var theme = window.localStorage.getItem("${themeStorageKey}") || "system";

    if (theme !== "light" && theme !== "dark" && theme !== "system") {
      theme = "system";
    }

    var resolvedTheme = theme;

    if (theme === "system") {
      resolvedTheme = window.matchMedia("${themeMediaQuery}").matches
        ? "dark"
        : "light";
    }

    var root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  } catch (error) {
    return;
  }
})();
`;
