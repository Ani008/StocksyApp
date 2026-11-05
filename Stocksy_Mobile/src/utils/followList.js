// src/utils/followList.js
//
// Small rules for the Followers / Following page. No React, no network — kept
// apart so tests/followList.test.mjs can check them.

export const FOLLOW_TABS = [
  { key: "followers", label: "Followers" },
  { key: "following", label: "Following" },
];

const TAB_KEYS = FOLLOW_TABS.map((t) => t.key);

// Which tab the page opens on. Tapping "Followers" on the Profile passes
// "followers", tapping "Following" passes "following". Anything else (no param,
// a mistyped web link like /connections?initialTab=foo) opens on Followers.
export const resolveInitialTab = (raw) => (TAB_KEYS.includes(raw) ? raw : "followers");

// What the empty list says, per tab.
export const EMPTY_STATE = {
  followers: {
    title: "You don't have any followers yet",
    message: "Search for your friends and follow them to get started.",
  },
  following: {
    title: "You don't follow anyone yet",
    message: "Search for profiles and start following your friends.",
  },
};
