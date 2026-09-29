import { en, type Strings } from "./en";

let active: Strings = en;

export function setLocale(strings: Strings): void {
  active = strings;
}

export function t(): Strings {
  return active;
}
