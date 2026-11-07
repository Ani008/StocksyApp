// VU Trading Competition: shared look and content.
// Source of truth for the rules text is the "VU Trading Competition: Build Plan"
// (locked decisions). Open questions (fees, prizes, exact tie-break, whether a loss
// cancels earlier wins) are deliberately NOT stated here until they are decided.

// College colours: Persian blue, orange and white.
export const VU = {
  blue: "#1C39BB",
  blueDeep: "#12238A",
  blueLight: "#3A5BE0",
  orange: "#F97316",
  orangeLight: "#FDBA74",
  orangeDeep: "#EA580C",
  white: "#FFFFFF",
};

// Division A to G. To add another division later, just add its letter here.
export const DIVISIONS = ["A", "B", "C", "D", "E", "F", "G"].map((letter) => ({
  key: letter,
  label: `Division ${letter}`,
}));

export const OVERVIEW = {
  text:
    "An intraday trading contest for VU students. Everyone gets the same virtual ₹5,00,000 wallet, " +
    "trades on live market prices and is ranked on profit after all charges. " +
    "Attend your division's workshop, join here, then trade your way up the leaderboard.",
  facts: [
    { icon: "wallet", value: "₹5,00,000", label: "Virtual wallet" },
    { icon: "flash", value: "Intraday", label: "MIS orders only" },
    { icon: "time", value: "3:30 PM", label: "Contest ends" },
  ],
  steps: [
    { title: "Attend the workshop", body: "One division per slot." },
    { title: "Join with your division", body: "Before the contest starts." },
    { title: "Trade and climb", body: "Ends 3:30 PM the day after it starts." },
  ],
  note: "Exact dates will be shared at your workshop.",
};

export const RULES = [
  {
    title: "Entry",
    icon: "ticket",
    items: [
      "Only students of the VU divisions can enter. Pick your own division.",
      "One entry per student and one account per person. Duplicate accounts can be disqualified.",
      "Sign up, verify your email and join before the contest starts. Registration closes when the contest starts, so there are no late joiners.",
      "Your contest wallet appears after the workshop and stays locked until the contest starts.",
    ],
  },
  {
    title: "Trading",
    icon: "trending-up",
    items: [
      "Intraday (MIS) orders only. Delivery (CNC) orders are rejected on the contest wallet.",
      "Everyone gets the same ₹5,00,000 virtual wallet. No add-funds, no transfers, no edits.",
      "All stocks on the app can be traded.",
      "Orders are accepted only inside the contest window, on market days.",
      "Open intraday positions are squared off automatically at 3:20 PM each trading day.",
      "Fills include a small random slippage of up to 0.05% on each side. It applies to everyone.",
    ],
  },
  {
    title: "Scoring",
    icon: "podium",
    items: [
      "Your score is your profit after brokerage, STT and all other charges, on both the buy and the sell. ₹1 = 1 point.",
      "No negative points: your score never goes below 0. Ranking still uses your true net profit, so students with losses stay in order.",
      "Very small trades (for example 1 share) cost about ₹12 in charges, so they usually can't score.",
      "The leaderboard (global, division and friends) refreshes every 30–60 seconds.",
    ],
  },
  {
    title: "After the contest",
    icon: "flag",
    items: [
      "The contest ends at 3:30 PM the day after it starts, once the 3:20 PM square-off is done. The final ranking is then locked.",
      "The contest wallet is cleared. Your points, badges, streaks, transaction history and journal stay.",
      "Contest trades carry a glowing “VU Trade Competition” badge in history, journal and alerts.",
      "Organisers can pause, extend or void the contest if the price feed fails, and can disqualify unfair play.",
    ],
  },
];
