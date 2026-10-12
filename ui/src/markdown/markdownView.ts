export const markdownView: {
  read(): "rich" | "source";
  write(view: "rich" | "source"): void;
} = {
  read(): "rich" | "source" {
    try {
      return globalThis.localStorage?.getItem("forgerie.markdownView") === "source" ? "source" : "rich";
    } catch {
      // A device preference is optional when the browser denies storage access.
      return "rich";
    }
  },
  write(view: "rich" | "source"): void {
    try {
      globalThis.localStorage?.setItem("forgerie.markdownView", view);
    } catch {
      // Denied or full storage must not prevent switching the current editor.
    }
  },
};
