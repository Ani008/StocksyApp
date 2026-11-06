// config/avatars.js
//
// The avatars a user can pick from — the single source of truth. The app asks
// GET /api/avatars for this list, and the server accepts only these ids when a
// user saves one.
//
// An avatar is just an id such as "female_3". The pictures themselves live in
// the app and are looked up by id, so when you add avatar images to the app,
// make sure every id below has one. To offer more (or fewer), change
// PER_GENDER or edit the list — nothing else needs to change. Gender is only
// how the picker groups avatars; it is not stored on the user.

const GENDERS = ["male", "female"];
const PER_GENDER = 8;

const AVATARS = Object.freeze(
  GENDERS.flatMap((gender) =>
    Array.from({ length: PER_GENDER }, (_, i) =>
      Object.freeze({ id: `${gender}_${i + 1}`, gender }),
    ),
  ),
);

const AVATAR_IDS = new Set(AVATARS.map((a) => a.id));

const FOUNDER_AVATAR_ID = "founder_aniket";

const FOUNDER_AVATAR_EMAIL = (
  process.env.FOUNDER_AVATAR_EMAIL || ""
).trim().toLowerCase();

const isFounder = (email) =>
  typeof email === "string" &&
  FOUNDER_AVATAR_EMAIL !== "" &&
  email.trim().toLowerCase() === FOUNDER_AVATAR_EMAIL;

const isAvatarId = (value, email) => {
  if (typeof value !== "string") return false;

  if (AVATAR_IDS.has(value)) return true;

  return value === FOUNDER_AVATAR_ID && isFounder(email);
};

const getAvatarsForUser = (email) => {
  if (!isFounder(email)) return AVATARS;

  return [
    ...AVATARS,
    {
      id: FOUNDER_AVATAR_ID,
      gender: "male",
      exclusive: true,
    },
  ];
};

module.exports = {
  GENDERS,
  AVATARS,
  FOUNDER_AVATAR_ID,
  isFounder,
  isAvatarId,
  getAvatarsForUser,
};