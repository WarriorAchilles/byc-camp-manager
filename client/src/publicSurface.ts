export type BrowserSurface = "admin" | "registration";

export function resolveBrowserSurface(input: {
  currentOrigin: string;
  currentHostname: string;
  registrationOrigin?: string;
}): BrowserSurface {
  if (input.registrationOrigin) {
    return input.currentOrigin === input.registrationOrigin.replace(/\/+$/, "")
      ? "registration"
      : "admin";
  }
  return input.currentHostname.toLowerCase().startsWith("registration.")
    ? "registration"
    : "admin";
}
