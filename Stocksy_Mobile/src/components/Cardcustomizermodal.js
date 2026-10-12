import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  StatusBar,
} from "react-native";
import Modal from "./AppModal";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import DemoCard, { CARD_SKINS } from "./DemoCard";

import { Colors, Typography, fontScale, moderateScale, SCREEN_WIDTH } from "../theme";

const CARD_SPACING = moderateScale(20);
const CARD_WIDTH = SCREEN_WIDTH - moderateScale(80);
const CARD_PREVIEW_HEIGHT = moderateScale(210);

/**
 * CardCustomizerModal
 * Full-screen modal for selecting a card skin.
 * Scroll left/right to preview skins. Tick button to confirm.
 *
 * Props:
 * @param {boolean}  visible         - Controlled visibility
 * @param {function} onClose         - Called on dismiss
 * @param {string}   currentSkinId   - Active skin id
 * @param {number}   balance         - Demo balance for preview
 * @param {function} onSelectSkin    - Called with chosen skin object on confirm
 */
const CardCustomizerModal = ({
  visible,
  onClose,
  currentSkinId,
  balance,
  onSelectSkin,
}) => {
  const initialIndex = CARD_SKINS.findIndex((s) => s.id === currentSkinId) || 0;
  const [activeIndex, setActiveIndex] = useState(initialIndex >= 0 ? initialIndex : 0);
  const scrollRef = useRef(null);

  const handleScroll = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    const index = Math.round(x / (CARD_WIDTH + CARD_SPACING));
    setActiveIndex(Math.max(0, Math.min(index, CARD_SKINS.length - 1)));
  };

  const handleConfirm = () => {
    onSelectSkin(CARD_SKINS[activeIndex]);
    onClose();
  };

  const activeSkin = CARD_SKINS[activeIndex];

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={[Colors.chartBg, "#0D1117", Colors.text]}
        style={styles.container}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={moderateScale(22)} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Choose Card Style</Text>
          {/* Confirm tick */}
          <TouchableOpacity onPress={handleConfirm} style={styles.confirmBtn}>
            <LinearGradient
              colors={[activeSkin.accentColor, activeSkin.accentColor + "CC"]}
              style={styles.confirmGradient}
            >
              <Ionicons name="checkmark" size={moderateScale(20)} color={Colors.white} />
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Card Scroll Preview */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled={false}
          snapToInterval={CARD_WIDTH + CARD_SPACING}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          onMomentumScrollEnd={handleScroll}
          style={styles.cardScroll}
        >
          {CARD_SKINS.map((skin, index) => {
            const isActive = index === activeIndex;
            return (
              <TouchableOpacity
                key={skin.id}
                activeOpacity={0.9}
                onPress={() => {
                  setActiveIndex(index);
                  scrollRef.current?.scrollTo({
                    x: index * (CARD_WIDTH + CARD_SPACING),
                    animated: true,
                  });
                }}
                style={[
                  styles.cardWrapper,
                  {
                    width: CARD_WIDTH,
                    marginRight: CARD_SPACING,
                    transform: [{ scale: isActive ? 1 : 0.9 }],
                    opacity: isActive ? 1 : 0.6,
                  },
                ]}
              >
                <DemoCard
                  balance={balance}
                  skin={skin}
                  style={{ width: "100%", height: CARD_PREVIEW_HEIGHT }}
                />
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Dot indicators */}
        <View style={styles.dots}>
          {CARD_SKINS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === activeIndex && {
                  backgroundColor: activeSkin.accentColor,
                  width: moderateScale(20),
                },
              ]}
            />
          ))}
        </View>

        {/* Skin name */}
        <Text style={[styles.skinName, { color: activeSkin.accentColor }]}>
          {activeSkin.label}
        </Text>

        {/* Skin swatches grid */}
        <View style={styles.swatchRow}>
          {CARD_SKINS.map((skin, index) => (
            <TouchableOpacity
              key={skin.id}
              onPress={() => {
                setActiveIndex(index);
                scrollRef.current?.scrollTo({
                  x: index * (CARD_WIDTH + CARD_SPACING),
                  animated: true,
                });
              }}
              style={styles.swatchWrapper}
            >
              <LinearGradient
                colors={skin.colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.swatch,
                  index === activeIndex && {
                    borderColor: skin.accentColor,
                    borderWidth: 2.5,
                    transform: [{ scale: 1.15 }],
                  },
                ]}
              />
              {index === activeIndex && (
                <Ionicons
                  name="checkmark-circle"
                  size={moderateScale(14)}
                  color={skin.accentColor}
                  style={styles.swatchCheck}
                />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Apply button */}
        <TouchableOpacity onPress={handleConfirm} style={styles.applyBtn}>
          <LinearGradient
            colors={[activeSkin.accentColor, activeSkin.accentColor + "AA"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.applyGradient}
          >
            <Ionicons name="checkmark-circle-outline" size={moderateScale(20)} color={Colors.white} style={{ marginRight: moderateScale(8) }} />
            <Text style={styles.applyText}>Apply "{activeSkin.label}"</Text>
          </LinearGradient>
        </TouchableOpacity>
      </LinearGradient>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: moderateScale(60),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(24),
    marginBottom: moderateScale(6),
  },
  closeBtn: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(19),
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    color: Colors.white,
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  confirmBtn: {
    borderRadius: moderateScale(19),
    overflow: "hidden",
  },
  confirmGradient: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(19),
    justifyContent: "center",
    alignItems: "center",
  },
  subtitle: {
    color: "rgba(255,255,255,0.35)",
    fontSize: fontScale(Typography.small),
    textAlign: "center",
    letterSpacing: 0.5,
    marginBottom: moderateScale(32),
  },
  cardScroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: moderateScale(20),
  },
  cardWrapper: {
    borderRadius: moderateScale(24),
    overflow: "visible",
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: moderateScale(24),
    gap: moderateScale(6),
  },
  dot: {
    width: moderateScale(6),
    height: moderateScale(6),
    borderRadius: moderateScale(3),
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  skinName: {
    textAlign: "center",
    fontSize: fontScale(Typography.h3),
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: moderateScale(16),
    marginBottom: moderateScale(24),
  },
  swatchRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: moderateScale(12),
    marginHorizontal: moderateScale(24),
    marginBottom: moderateScale(32),
  },
  swatchWrapper: {
    alignItems: "center",
    position: "relative",
  },
  swatch: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(18),
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchCheck: {
    position: "absolute",
    bottom: moderateScale(-5),
    right: moderateScale(-2),
    backgroundColor: Colors.chartBg,
    borderRadius: moderateScale(7),
  },
  applyBtn: {
    marginHorizontal: moderateScale(24),
    borderRadius: moderateScale(16),
    overflow: "hidden",
  },
  applyGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: moderateScale(16),
    borderRadius: moderateScale(16),
  },
  applyText: {
    color: Colors.white,
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});

export default CardCustomizerModal;