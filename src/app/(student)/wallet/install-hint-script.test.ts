import { afterEach, expect, test } from "vitest";
import { IOS_INSTALL_HINT_SCRIPT, IOS_INSTALL_HINT_STORAGE_KEY } from "./install-hint-script";

const IOS_SAFARI_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const navigatorDescriptors = new Map<string, PropertyDescriptor | undefined>();
const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  for (const [name, descriptor] of navigatorDescriptors) {
    if (descriptor) Object.defineProperty(navigator, name, descriptor);
    else delete (navigator as unknown as Record<string, unknown>)[name];
  }
  navigatorDescriptors.clear();
  if (matchMediaDescriptor) Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
  else delete (window as unknown as Record<string, unknown>).matchMedia;
});

function runScript(): void {
  const execute = Function(IOS_INSTALL_HINT_SCRIPT);
  execute();
}

function setNavigator(name: string, value: unknown): void {
  if (!navigatorDescriptors.has(name)) {
    navigatorDescriptors.set(name, Object.getOwnPropertyDescriptor(navigator, name));
  }
  Object.defineProperty(navigator, name, {
    configurable: true,
    value,
  });
}

function boot(options: {
  userAgent: string;
  platform?: string;
  standalone?: boolean;
  touchPoints?: number;
}): void {
  document.body.innerHTML = `<aside data-ios-install-hint hidden><button type="button" data-ios-install-dismiss>Dismiss</button></aside>`;
  setNavigator("userAgent", options.userAgent);
  setNavigator("platform", options.platform ?? "iPhone");
  setNavigator("maxTouchPoints", options.touchPoints ?? 5);
  setNavigator("standalone", false);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: options.standalone === true }),
  });
  runScript();
}

function hint(): HTMLElement {
  return document.querySelector("[data-ios-install-hint]") as HTMLElement;
}

test("shows on iOS Safari when not running standalone", () => {
  boot({ userAgent: IOS_SAFARI_USER_AGENT });

  expect(hint().hidden).toBe(false);
});

test.each([
  ["standalone", { userAgent: IOS_SAFARI_USER_AGENT, standalone: true }],
  [
    "Android",
    {
      userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
    },
  ],
  [
    "desktop",
    {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15",
      platform: "MacIntel",
      touchPoints: 0,
    },
  ],
])("stays hidden on %s", (_name, options) => {
  boot(options);

  expect(hint().hidden).toBe(true);
});

test("dismissal is remembered across reloads", () => {
  boot({ userAgent: IOS_SAFARI_USER_AGENT });
  const firstHint = hint();

  (firstHint.querySelector("[data-ios-install-dismiss]") as HTMLButtonElement).click();
  expect(firstHint.hidden).toBe(true);
  expect(localStorage.getItem(IOS_INSTALL_HINT_STORAGE_KEY)).toBe("true");

  document.body.innerHTML = `<aside data-ios-install-hint hidden><button type="button" data-ios-install-dismiss>Dismiss</button></aside>`;
  runScript();

  expect(hint().hidden).toBe(true);
});
