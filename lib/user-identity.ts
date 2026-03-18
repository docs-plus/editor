export type UserIdentity = {
  name: string;
  color: string;
};

export const CARET_COLORS = [
  "#E57373",
  "#F06292",
  "#BA68C8",
  "#64B5F6",
  "#4DB6AC",
  "#81C784",
  "#FFB74D",
  "#A1887F",
] as const;

const STORAGE_KEY = "tinydocy-user";

const ADJECTIVES = [
  "Bold",
  "Brave",
  "Bright",
  "Calm",
  "Clever",
  "Cool",
  "Curious",
  "Daring",
  "Eager",
  "Gentle",
  "Happy",
  "Keen",
  "Kind",
  "Lively",
  "Lucky",
  "Noble",
  "Quick",
  "Sharp",
  "Swift",
  "Wise",
];

const ANIMALS = [
  "Bear",
  "Crane",
  "Dolphin",
  "Eagle",
  "Falcon",
  "Fox",
  "Hawk",
  "Koala",
  "Lion",
  "Lynx",
  "Otter",
  "Owl",
  "Panda",
  "Raven",
  "Robin",
  "Seal",
  "Swan",
  "Tiger",
  "Wolf",
  "Wren",
];

function randomItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomName(): string {
  return `${randomItem(ADJECTIVES)} ${randomItem(ANIMALS)}`;
}

export function getUserIdentity(): UserIdentity {
  if (typeof window === "undefined") {
    return { name: generateRandomName(), color: randomItem(CARET_COLORS) };
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as UserIdentity;
      if (typeof parsed.name === "string" && typeof parsed.color === "string")
        return parsed;
    } catch {
      /* regenerate below */
    }
  }

  const identity: UserIdentity = {
    name: generateRandomName(),
    color: randomItem(CARET_COLORS),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function saveUserIdentity(identity: UserIdentity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}
