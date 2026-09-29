// Alias + GUID local profile (eps-demo-identity). Only the GUID ever leaves the
// browser, and only as a rate-limit bucket key. It is a lookup handle, not a login.
const KEY = "bm.profile.v1";

const ADJECTIVES = ["Curious", "Brave", "Calm", "Clever", "Friendly", "Nimble", "Quiet", "Sunny"];
const ANIMALS = ["Otter", "Falcon", "Panda", "Fox", "Heron", "Koala", "Lynx", "Owl"];

export interface Profile {
  alias: string;
  id: string;
}

type Random = () => number;

export function makeProfile(
  random: Random = Math.random,
  uuid = () => crypto.randomUUID(),
): Profile {
  const pick = (items: string[]) => items[Math.floor(random() * items.length)];
  const number = 1000 + Math.floor(random() * 9000);
  return { alias: `${pick(ADJECTIVES)} ${pick(ANIMALS)} ${number}`, id: uuid() };
}

export function loadProfile(storage: Storage = localStorage): Profile {
  try {
    const stored = JSON.parse(storage.getItem(KEY) ?? "null") as Profile | null;
    if (stored && typeof stored.alias === "string" && /^[0-9a-f-]{36}$/.test(stored.id)) {
      return stored;
    }
  } catch {
    // Corrupt storage falls through to a fresh profile.
  }
  return resetProfile(storage);
}

export function resetProfile(storage: Storage = localStorage): Profile {
  const profile = makeProfile();
  storage.setItem(KEY, JSON.stringify(profile));
  return profile;
}
