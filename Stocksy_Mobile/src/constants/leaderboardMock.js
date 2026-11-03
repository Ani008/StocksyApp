/**
 * TEMPORARY leaderboard data, so the screen can be built before the backend is
 * ready. Delete this file once the real API is connected.
 *
 * Shape each entry like this (so the backend response can drop straight in):
 *   id        unique user id
 *   name      the user's unique username
 *   points    the score the ranking is based on
 *   avatarUrl optional image URL; when missing, a circle with initials is shown
 *
 * The list is already sorted by points, highest first. Rank is the position in
 * the list (index + 1), so the page never stores a rank of its own.
 */
export const MOCK_LEADERBOARD = [
  { id: "u1", name: "Kaizen", points: 410, avatarUrl: null },
  { id: "u2", name: "Boabo", points: 301, avatarUrl: null },
  { id: "u3", name: "Meome", points: 175, avatarUrl: null },
  { id: "u4", name: "EviMonkey", points: 160, avatarUrl: null },
  { id: "u5", name: "CutieeNeko", points: 158, avatarUrl: null },
  { id: "u6", name: "Motorono", points: 150, avatarUrl: null },
  { id: "u7", name: "BullRunner", points: 142, avatarUrl: null },
  { id: "u8", name: "NiftyNinja", points: 131, avatarUrl: null },
  { id: "u9", name: "DalalDost", points: 118, avatarUrl: null },
  { id: "u10", name: "ChartWizard", points: 104, avatarUrl: null },
];
