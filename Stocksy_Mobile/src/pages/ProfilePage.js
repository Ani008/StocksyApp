import React, { useEffect, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
  Linking,
  Platform,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { resetToLogin } from "../../services/navigation";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import authService from "../../services/authService";
import { getMyProfile } from "../../services/profileService";
import { showToast } from "../../services/uiBridge";
import AvatarBadge from "../components/AvatarBadge";
import {
  safeCount,
  formatCount,
  followersLabel,
  followingLabel,
} from "../utils/followCounts";
import DeleteAccountModal from "../components/DeleteAccountModal";
import FlameIcon from "../components/FlameIcon";
import LeaderboardIcon from "../components/LeaderboardIcon";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const APP_VERSION = "1.0.0";

// The avatar, and the height of the avatar + its rings. The counts are centred
// against this so they sit level with the picture, not with the username.
const AVATAR_SIZE = moderateScale(72);
const AVATAR_BLOCK_HEIGHT = AVATAR_SIZE + 14; // AvatarBadge ring/gap (10) + border (4)
const SUPPORT_EMAIL = "support@stocksy.online";

const ProfilePage = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState(null);
  const [accountExpanded, setAccountExpanded] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", loadUser);
    loadUser();
    return unsubscribe;
  }, [navigation]);

  const loadUser = async () => {
    try {
      // Show what is stored on the phone straight away...
      const stored = await AsyncStorage.getItem("user");
      if (stored) setUser(JSON.parse(stored));
    } catch (err) {
      console.log(err);
    }

    // ...then check the server, so an avatar or username changed elsewhere (or
    // chosen in the setup box) is right here without logging in again. If the
    // request fails the stored copy stays on screen.
    try {
      const me = await getMyProfile();
      const fresh = {
        username: me.username,
        usernameSet: Boolean(me.username), // the server sends null until chosen
        avatarId: me.avatarId ?? null,
        followersCount: safeCount(me.followersCount),
        followingCount: safeCount(me.followingCount),
      };
      setUser((prev) => ({ ...prev, ...fresh }));

      // Remember the counts on the phone so the next visit shows the last
      // known numbers straight away instead of flashing 0 until the server
      // answers. (Best effort; the server stays the source of truth.)
      try {
        const raw = await AsyncStorage.getItem("user");
        if (raw) {
          await AsyncStorage.setItem(
            "user",
            JSON.stringify({
              ...JSON.parse(raw),
              followersCount: fresh.followersCount,
              followingCount: fresh.followingCount,
            }),
          );
        }
      } catch {
        /* not worth surfacing */
      }
    } catch {
      /* offline: keep the stored profile */
    }
  };

  // Tapping a count opens the Followers / Following page on that tab.
  const openFollowList = (initialTab) =>
    navigation.navigate("FollowList", {
      initialTab,
      username: user?.usernameSet ? user.username : undefined,
    });

  const performLogout = async () => {
    try {
      console.log("🔥 LOGOUT STARTED");

      // Revokes the session on the server and wipes everything stored here.
      // (It used to only delete local storage, so the old token stayed valid.)
      try {
        await authService.logout();
      } catch (e) {
        // Server unreachable: local state was still wiped (authService's
        // finally block), so the person is logged out on this device.
        console.log("Logout request failed:", e?.message);
      }

      console.log("✅ Session ended");

      resetToLogin();

      console.log("✅ LOGOUT COMPLETE");
    } catch (error) {
      console.error("❌ LOGOUT ERROR:", error);
    }
  };

  const handleLogout = () => {
    console.log("🔥 LOGOUT BUTTON PRESSED");

    // ─────────────────────────────────────────────
    // WEB / PWA
    // ─────────────────────────────────────────────
    if (Platform.OS === "web") {
      const confirmed = window.confirm("Are you sure you want to logout?");

      console.log("Web logout confirmation:", confirmed);

      if (confirmed) {
        performLogout();
      }

      return;
    }

    // ─────────────────────────────────────────────
    // ANDROID / iOS
    // Keep native Alert behavior unchanged.
    // ─────────────────────────────────────────────
    Alert.alert("Logout", "Are you sure you want to logout?", [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Logout",
        style: "destructive",
        onPress: performLogout,
      },
    ]);
  };

  const handleInvite = async () => {
    try {
      await Share.share({
        message:
          "I've been building my portfolio on Stocksy — a zero-risk way to learn real trading with live market data. Join me and let's figure out the markets together 📈\n\nhttps://stocksy.app/invite",
      });
    } catch (err) {
      // Silent — the share sheet failing to open isn't worth alarming over.
    }
  };

  const handleSupport = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {
      Alert.alert(
        "Couldn't open email",
        `Reach us anytime at ${SUPPORT_EMAIL}`,
      );
    });
  };

  const handleDeleteAccount = async (password) => {
    setDeletingAccount(true);
    try {
      await authService.deleteAccount(password);
      setDeleteModalVisible(false);
      showToast("Your account has been permanently deleted.", "success");
      navigation.replace("Login");
    } catch (err) {
      // Error toast is already shown globally by the api.js interceptor
      // (e.g. "Incorrect password" or the validation message) — just
      // keep the modal open so they can retry.
    } finally {
      setDeletingAccount(false);
    }
  };

  const displayName = user?.fullName || user?.username || "Trader";
  const displayEmail = user?.email || "—";
  // Only a username the person actually chose is shown; until then the stored
  // `username` is just their first name, which is not a handle.
  const username = user?.usernameSet ? user.username : null;

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      <StatusBar style="light" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <View
          style={[styles.hero, { paddingTop: insets.top + moderateScale(16) }]}
        >
          <View style={styles.heroTopRow}>
            <Text style={styles.heroTitle}>Profile</Text>

            <View style={styles.heroActions}>
              <TouchableOpacity
                style={styles.streakBtn}
                activeOpacity={0.8}
                onPress={() => navigation.navigate("Leaderboard")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Open the leaderboard"
              >
                <LeaderboardIcon size={moderateScale(22)} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.streakBtn}
                activeOpacity={0.8}
                onPress={() => navigation.navigate("Streak")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Open your streak"
              >
                <FlameIcon size={moderateScale(24)} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Instagram-style header: the picked avatar with the username under
              it, and the followers / following counts to its right. A count
              is 0 until someone follows (or you follow someone). */}
          <View style={styles.profileRow}>
            <View style={styles.identity}>
              <View style={styles.avatarRing}>
                <AvatarBadge avatarId={user?.avatarId} size={AVATAR_SIZE} />
              </View>

              {!!username && (
                <Text style={styles.username} numberOfLines={1}>
                  {username}
                </Text>
              )}
            </View>

            <View style={styles.statsRow}>
              <TouchableOpacity
                style={styles.stat}
                activeOpacity={0.7}
                onPress={() => openFollowList("followers")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`${followersLabel(user?.followersCount)}, see list`}
              >
                <Text style={styles.statCount} numberOfLines={1}>
                  {formatCount(user?.followersCount)}
                </Text>
                <Text style={styles.statLabel}>Followers</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.stat}
                activeOpacity={0.7}
                onPress={() => openFollowList("following")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`${followingLabel(user?.followingCount)}, see list`}
              >
                <Text style={styles.statCount} numberOfLines={1}>
                  {formatCount(user?.followingCount)}
                </Text>
                <Text style={styles.statLabel}>Following</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <View style={styles.body}>
          {/* Orders — every order ever placed, Delivery/Intraday toggle lives
              on the OrderHistory screen itself (same pattern as the
              Dashboard's Total Assets card). */}
          <TouchableOpacity
            style={[styles.card, styles.cardHeaderRow]}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("OrderHistory")}
          >
            <View style={styles.cardLeft}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: Colors.primaryLight },
                ]}
              >
                <Ionicons
                  name="receipt-outline"
                  size={20}
                  color={Colors.primaryDark}
                />
              </View>
              <View>
                <Text style={styles.cardTitle}>Orders</Text>
                <Text style={styles.cardSub}>
                  Every order you've placed, all time
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>

          {/* Account details — expands in place rather than navigating away,
              since it's just a couple of read-only fields. */}
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.cardHeaderRow}
              activeOpacity={0.7}
              onPress={() => setAccountExpanded((v) => !v)}
            >
              <View style={styles.cardLeft}>
                <View
                  style={[
                    styles.iconCircle,
                    { backgroundColor: Colors.successBg },
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={20}
                    color={Colors.success}
                  />
                </View>
                <View>
                  <Text style={styles.cardTitle}>Account details</Text>
                  <Text style={styles.cardSub}>Name, email & trader ID</Text>
                </View>
              </View>
              <Ionicons
                name={accountExpanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={Colors.textMuted}
              />
            </TouchableOpacity>

            {accountExpanded && (
              <View style={styles.expandedContent}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Full name</Text>
                  <Text style={styles.detailValue} numberOfLines={1}>
                    {displayName}
                  </Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Email</Text>
                  <Text style={styles.detailValue} numberOfLines={1}>
                    {displayEmail}
                  </Text>
                </View>
                {!!user?.id && (
                  <>
                    <View style={styles.detailDivider} />
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Trader ID</Text>
                      <Text style={styles.detailValue} numberOfLines={1}>
                        {user.id.slice(0, 8).toUpperCase()}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>

          {/* Wallet & Funds — reuses the existing WalletScreen rather than
              duplicating balance/withdraw logic here. */}
          <TouchableOpacity
            style={[styles.card, styles.cardHeaderRow]}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("Wallet")}
          >
            <View style={styles.cardLeft}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: Colors.warningBg },
                ]}
              >
                <Ionicons
                  name="wallet-outline"
                  size={20}
                  color={Colors.warning}
                />
              </View>
              <View>
                <Text style={styles.cardTitle}>Wallet & Funds</Text>
                <Text style={styles.cardSub}>
                  Balances, cards & transactions
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>

          {/* Alerts — price alerts & GTT orders */}
          <TouchableOpacity
            style={[styles.card, styles.cardHeaderRow]}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("Alerts")}
          >
            <View style={styles.cardLeft}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: Colors.primaryLight },
                ]}
              >
                <Ionicons
                  name="notifications-outline"
                  size={20}
                  color={Colors.primaryDark}
                />
              </View>
              <View>
                <Text style={styles.cardTitle}>Alerts</Text>
                <Text style={styles.cardSub}>Price alerts & GTT orders</Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>

          {/* {Refer & Invite}
          <View style={[styles.card, styles.referCard]}>
            <View style={styles.referIconRing}>
              <Ionicons name="heart" size={22} color={Colors.gain} />
            </View>
            <Text style={styles.referTitle}>Share the journey</Text>
            <Text style={styles.referBody}>
              Every confident investor started somewhere — usually with a friend who
              nudged them to begin. Be that person. Invite someone you care about to
              start learning the markets with you, risk-free.
            </Text>
            <TouchableOpacity
              style={styles.referBtn}
              activeOpacity={0.85}
              onPress={handleInvite}
            >
              <Ionicons name="paper-plane-outline" size={16} color={Colors.white} />
              <Text style={styles.referBtnText}>Invite a friend</Text>
            </TouchableOpacity>
          </View> */}

          {/* Customer support */}
          <TouchableOpacity
            style={[styles.card, styles.cardHeaderRow]}
            activeOpacity={0.7}
            onPress={handleSupport}
          >
            <View style={styles.cardLeft}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: Colors.primaryLight },
                ]}
              >
                <Ionicons
                  name="headset-outline"
                  size={20}
                  color={Colors.primaryDark}
                />
              </View>
              <View>
                <Text style={styles.cardTitle}>Customer support</Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>

          {/* About */}
          <TouchableOpacity
            style={[styles.card, styles.cardHeaderRow]}
            activeOpacity={0.7}
            onPress={() => setAboutExpanded((v) => !v)}
          >
            <View style={styles.cardLeft}>
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: Colors.dangerBg },
                ]}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={20}
                  color={Colors.danger}
                />
              </View>
              <Text style={styles.cardTitle}>About</Text>
            </View>
            <Ionicons
              name={aboutExpanded ? "chevron-up" : "chevron-down"}
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>
          {aboutExpanded && (
            <View style={styles.aboutContent}>
              <View style={styles.aboutTitleRow}>
                <Text style={styles.aboutAppName}>Stocksy</Text>
                <View style={styles.aboutVersionBadge}>
                  <Text style={styles.aboutVersionText}>v{APP_VERSION}</Text>
                </View>
              </View>
              <Text style={styles.aboutTagline}>
                Paper trading, built on real brokerage infrastructure
              </Text>

              <Text style={styles.aboutBody}>
                Stocksy simulates a full equity brokerage end to end live market
                data, order matching, wallet ledgering, and portfolio tracking
                so anyone can practise trading with zero financial risk. Every
                trade runs through the same kind of engine a licensed broker
                would use.
              </Text>

              <Text style={styles.aboutSectionLabel}>UNDER THE HOOD</Text>
              <View style={styles.aboutTagRow}>
                {[
                  "Order Management System",
                  "Live Market Data",
                  "Portfolio Analytics",
                  "Wallet & Ledger Engine",
                  "PostgreSQL",
                  "Redis Streaming",
                ].map((tag) => (
                  <View key={tag} style={styles.aboutTag}>
                    <Text style={styles.aboutTagText}>{tag}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.aboutSectionLabel}>WHERE THIS IS HEADED</Text>
              <Text style={styles.aboutBody}>
                Stocksy is built as the foundation for a real, licensed
                brokerage or a white-label trading-infrastructure product the
                OMS, risk engine, and ledgering here are architected to extend
                beyond simulation.
              </Text>

              <View style={styles.aboutDivider} />

              <Text style={styles.aboutFounderText}>Built by Aniket</Text>
              <TouchableOpacity
                onPress={() =>
                  Linking.openURL(
                    `mailto:${SUPPORT_EMAIL}?subject=Stocksy — let's talk`,
                  ).catch(() =>
                    Alert.alert(
                      "Couldn't open email",
                      `Reach out at ${SUPPORT_EMAIL}`,
                    ),
                  )
                }
                activeOpacity={0.7}
              >
                <Text style={styles.aboutContactLink}>
                  Interested in investing or partnering? Get in touch →
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Logout */}
          <TouchableOpacity
            style={styles.logoutCard}
            onPress={() => {
              console.log("🚨 TOUCHABLE LOGOUT CLICKED");
              handleLogout();
            }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="logout"
              size={20}
              color={Colors.danger}
            />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>

          {/* Delete Account — separated from Logout so it's not mistaken
              for the same, much more common, action. */}
          <TouchableOpacity
            style={styles.deleteAccountCard}
            onPress={() => setDeleteModalVisible(true)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="delete-outline"
              size={18}
              color={Colors.textMuted}
            />
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <DeleteAccountModal
        visible={deleteModalVisible}
        onConfirm={handleDeleteAccount}
        onCancel={() => setDeleteModalVisible(false)}
        loading={deletingAccount}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: moderateScale(50) },

  // ── Hero ───────────────────────────────────────────────────────────────
  hero: {
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(24),
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    marginBottom: moderateScale(20),
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: moderateScale(20),
  },
  heroTitle: {
    fontSize: fontScale(Typography.h2),
    fontWeight: "800",
    color: Colors.white,
  },
  // Leaderboard + streak buttons, side by side on the right of the header.
  heroActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
  },
  // Round white buttons: the flame opens Streak, the podium opens Leaderboard.
  streakBtn: {
    width: moderateScale(40),
    height: moderateScale(40),
    borderRadius: moderateScale(20),
    backgroundColor: Colors.white,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.black,
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(14),
  },
  // Avatar with the username centred under it; the counts sit to its right.
  identity: {
    alignItems: "center",
    maxWidth: moderateScale(130),
  },
  // Soft ring around the avatar so it reads on the blue hero.
  avatarRing: {
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  username: {
    marginTop: moderateScale(8),
    color: Colors.white,
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
  },
  // Followers / following, to the right of the avatar.
  statsRow: {
    flex: 1,
    height: AVATAR_BLOCK_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  stat: { alignItems: "center", minWidth: moderateScale(64) },
  statCount: {
    color: Colors.white,
    fontSize: fontScale(Typography.h3),
    fontWeight: "800",
  },
  statLabel: {
    marginTop: moderateScale(2),
    color: "rgba(255,255,255,0.8)",
    fontSize: fontScale(13),
    fontWeight: "500",
  },

  // ── Body ───────────────────────────────────────────────────────────────
  body: { paddingHorizontal: moderateScale(20) },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: moderateScale(16),
    marginBottom: moderateScale(14),
    shadowColor: Colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
    flex: 1,
    marginRight: moderateScale(8),
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  cardTitle: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
  },
  cardSub: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
    marginTop: moderateScale(2),
  },

  expandedContent: {
    marginTop: moderateScale(14),
    paddingTop: moderateScale(14),
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: moderateScale(4),
  },
  detailLabel: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
  },
  detailValue: {
    fontSize: fontScale(Typography.body),
    fontWeight: "600",
    color: Colors.text,
    maxWidth: "65%",
  },
  detailDivider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: moderateScale(8),
  },

  // ── Refer & Invite ────────────────────────────────────────────────────
  referCard: { alignItems: "flex-start" },
  referIconRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.gainBg,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: moderateScale(10),
  },
  referTitle: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
    marginBottom: moderateScale(6),
  },
  referBody: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
    lineHeight: moderateScale(20),
    marginBottom: moderateScale(14),
  },
  referBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: moderateScale(18),
    paddingVertical: moderateScale(11),
    borderRadius: 999,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  referBtnText: {
    color: Colors.white,
    fontWeight: "700",
    fontSize: fontScale(Typography.small),
  },

  // ── About ─────────────────────────────────────────────────────────────
  aboutContent: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: moderateScale(18),
    marginTop: -moderateScale(6),
    marginBottom: moderateScale(14),
  },
  aboutText: {
    color: Colors.textSecondary,
    marginBottom: moderateScale(6),
    lineHeight: 22,
  },
  aboutTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
  },
  aboutAppName: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "800",
    color: Colors.text,
  },
  aboutVersionBadge: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(2),
  },
  aboutVersionText: {
    fontSize: fontScale(Typography.tiny),
    fontWeight: "700",
    color: Colors.primaryDark,
  },
  aboutTagline: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
    fontStyle: "italic",
    marginTop: moderateScale(4),
    marginBottom: moderateScale(14),
  },
  aboutBody: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: moderateScale(14),
  },
  aboutSectionLabel: {
    fontSize: fontScale(Typography.tiny),
    fontWeight: "700",
    color: Colors.textMuted,
    letterSpacing: 0.6,
    marginBottom: moderateScale(8),
  },
  aboutTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: moderateScale(8),
    marginBottom: moderateScale(16),
  },
  aboutTag: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(6),
    borderWidth: 1,
    borderColor: Colors.divider,
  },
  aboutTagText: {
    fontSize: fontScale(Typography.tiny),
    fontWeight: "600",
    color: Colors.text,
  },
  aboutDivider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: moderateScale(14),
  },
  aboutFounderText: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "700",
    color: Colors.text,
    marginBottom: moderateScale(4),
  },
  aboutContactLink: {
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
    color: Colors.primary,
  },

  // ── Logout ────────────────────────────────────────────────────────────
  logoutCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: moderateScale(16),
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: moderateScale(10),
    marginTop: moderateScale(6),
  },
  logoutText: {
    color: Colors.danger,
    fontWeight: "700",
    fontSize: fontScale(Typography.bodyLarge),
  },

  // ── Delete Account ────────────────────────────────────────────────────
  deleteAccountCard: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: moderateScale(8),
    paddingVertical: moderateScale(14),
    marginTop: moderateScale(4),
  },
  deleteAccountText: {
    color: Colors.textMuted,
    fontWeight: "600",
    fontSize: fontScale(Typography.small),
  },
});

export default ProfilePage;
