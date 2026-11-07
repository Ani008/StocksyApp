const { pool } = require("../config/postgres");
const { POINTS } = require("../services/leaderboardLogic");

// The username other people see: the one the person CHOSE. Until they choose,
// users.username is still the old first-name placeholder, which is not unique
// and must not be shown as a handle — so it comes back NULL. (Same rule as
// followRepository.)
const HANDLE = `CASE WHEN u.username_set THEN u.username END`;

// One ranked table, for the people in `scope`.
//
//   scoped   who is on the board:
//              global  every verified account (an unverified signup can't log
//                      in, so it isn't someone to compete with)
//              friends the viewer + everyone the viewer follows
//   sotd     correct Stock of the Day rounds, COUNTED ONLY FOR COMPLETED DAYS.
//            The winners are hidden from a user until they have answered every
//            round (see stockOfTheDayLogic.viewDay); counting a half-played day
//            would let points creeping up on the board give the answers away.
//   nifty    Nifty calls settled as WON
//   streak   days the user checked in
//   scored   points added up for everyone on the board
//   ranked   ONLY people with at least 1 point, numbered 1..n: most points first,
//            ties go to whoever joined first, then by id so the order never
//            flickers. Someone with 0 points is not ranked at all — a board of
//            brand-new users is EMPTY, not a list of everyone tied on 0.
//
// The response is every row with rank <= limit PLUS the viewer's own row (only
// if they have points), so someone at rank 340 still sees "you are 340th".
// `total` is the number of ranked people, i.e. those with points. Weights come in as query parameters from leaderboardLogic.POINTS.
//
//   $1 viewer id   $2 friends-only?   $3 limit
//   $4 points per streak day   $5 per correct Stock of the Day round   $6 per Nifty win
const getLeaderboard = async ({ viewerId, scope, limit }) => {
  const result = await pool.query(
    `
    WITH scoped AS (
      SELECT u.id,
             u.full_name,
             ${HANDLE} AS handle,
             u.avatar,
             u.avatar_id,
             u.created_at
      FROM users u
      WHERE u.email_verified = TRUE
        AND (
          $2::boolean = FALSE
          OR u.id = $1
          OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id)
        )
    ),
    sotd AS (
      SELECT a.user_id, COUNT(*)::int AS correct
      FROM stock_of_the_day_answers a
      JOIN stock_of_the_day d ON d.play_date = a.play_date
      JOIN LATERAL jsonb_array_elements(d.payload->'rounds') AS r(round) ON TRUE
      WHERE a.user_id IN (SELECT id FROM scoped)
        AND (r.round->>'index')::int = a.round_index
        AND r.round->>'winnerKey' = a.picked_key
        AND (
          SELECT COUNT(*)
          FROM stock_of_the_day_answers x
          WHERE x.user_id = a.user_id AND x.play_date = a.play_date
        ) = jsonb_array_length(d.payload->'rounds')
      GROUP BY a.user_id
    ),
    nifty AS (
      SELECT p.user_id, COUNT(*)::int AS wins
      FROM nifty_predictions p
      WHERE p.status = 'WON'
        AND p.user_id IN (SELECT id FROM scoped)
      GROUP BY p.user_id
    ),
    streak AS (
      SELECT c.user_id, COUNT(*)::int AS days
      FROM user_streak_checkins c
      WHERE c.user_id IN (SELECT id FROM scoped)
      GROUP BY c.user_id
    ),
    scored AS (
      SELECT s.id,
             s.full_name,
             s.handle,
             s.avatar,
             s.avatar_id,
             s.created_at,
             COALESCE(streak.days, 0)   * $4::int
               + COALESCE(sotd.correct, 0) * $5::int
               + COALESCE(nifty.wins, 0)   * $6::int AS points
      FROM scoped s
      LEFT JOIN sotd   ON sotd.user_id   = s.id
      LEFT JOIN nifty  ON nifty.user_id  = s.id
      LEFT JOIN streak ON streak.user_id = s.id
    ),
    ranked AS (
      SELECT sc.id,
             sc.full_name,
             sc.handle,
             sc.avatar,
             sc.avatar_id,
             sc.points,
             ROW_NUMBER() OVER (ORDER BY sc.points DESC, sc.created_at ASC, sc.id ASC) AS rank,
             COUNT(*) OVER () AS total
      FROM scored sc
      WHERE sc.points > 0
    )
    SELECT id, full_name, handle, avatar, avatar_id, points::int AS points,
           rank::int AS rank, total::int AS total
    FROM ranked
    WHERE rank <= $3 OR id = $1
    ORDER BY rank
    `,
    [
      viewerId,
      scope === "friends",
      limit,
      POINTS.STREAK_DAY,
      POINTS.STOCK_OF_THE_DAY,
      POINTS.NIFTY_WIN,
    ],
  );

  return result.rows;
};

module.exports = { getLeaderboard };
