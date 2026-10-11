import { Dimensions, PixelRatio, Platform } from "react-native";

// ─── Design basis ─────────────────────────────────────────────────────────────
// Every size in the app is authored for a ~390 x 844 phone and scaled from the
// window width at startup (moderateScale / fontScale / SCREEN_WIDTH).
//
// That is right on phones, but on the WEB build the window can be anything.
// Unbounded, a 1440px desktop window scaled everything ~3.7x (text up to 66px,
// Login pushed below the fold), and a tablet ~2x.
//
// So on web the app is treated as a phone-sized column: the scale basis is
// bounded to [MIN_APP_WIDTH, MAX_APP_WIDTH], and <WebFrame> (App.js) centres a
// column of at most MAX_APP_WIDTH on wide screens. Native is unchanged.
export const MIN_APP_WIDTH = 320;
export const MAX_APP_WIDTH = 480;

const guidelineBaseWidth = 390;
const guidelineBaseHeight = 844;

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

function measure() {
  const win = Dimensions.get("window");
  if (Platform.OS !== "web") return { width: win.width, height: win.height };

  // A phone held sideways reports a wide, short window (e.g. 844 x 390). Its
  // short side is still the phone's real width, so use that rather than
  // treating it like a desktop.
  const shortSide = Math.min(win.width, win.height);
  const basis = shortSide < 500 ? shortSide : win.width;

  return {
    width: clamp(basis, MIN_APP_WIDTH, MAX_APP_WIDTH),
    // verticalScale / hp only matter for tall-ish layouts; keep them sane.
    height: clamp(win.height, 560, 1000),
  };
}

const { width, height } = measure();

export const SCREEN_WIDTH = width;
export const SCREEN_HEIGHT = height;

export const wp = (percent) =>
  (width * percent) / 100;

export const hp = (percent) =>
  (height * percent) / 100;

export const scale = (size) =>
  (width / guidelineBaseWidth) * size;

export const verticalScale = (size) =>
  (height / guidelineBaseHeight) * size;

export const moderateScale = (
  size,
  factor = 0.5
) =>
  size +
  (scale(size) - size) * factor;

export const fontScale = (size) =>
  PixelRatio.roundToNearestPixel(
    moderateScale(size)
  );
