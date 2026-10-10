import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";

import { Colors } from "../theme";

/**
 * ChartView (WEB) — same props and behaviour as ChartView.js, but renders
 * TradingView Lightweight Charts directly into a DOM node.
 *
 * Why a separate file: ChartView.js hosts the chart inside
 * react-native-webview, which has no web implementation (on web it renders
 * a red "does not support this platform" message instead of the chart).
 * Metro automatically picks this `.web.js` file on web and ChartView.js on
 * iOS/Android, so the native chart is completely untouched.
 *
 * Also: the library is bundled from npm (lightweight-charts@4.1.3, the same
 * version the native WebView loads from unpkg), so the web build has no
 * runtime CDN dependency and the chart works offline from the PWA shell.
 *
 * Credit: https://www.tradingview.com/lightweight-charts/
 *
 * Props:
 *   candles     array    — [{ time, open, high, low, close, volume }]
 *   livePrice   number   — current ltp, updates the last candle/point live
 *   isPositive  boolean  — true = green, false = red
 *   loading     boolean  — show spinner
 *   height      number|string — chart height (default 220, or e.g. "100%")
 *   chartType   string   — "area" (compact card, default) | "candles" (full OHLC + volume)
 *   showVolume  boolean  — show volume histogram pane (candles mode only, default true)
 */

const EMPTY = [];

const MUTED = "#94A3B8";

const colorsFor = (isPositive) => {
  const line = isPositive ? Colors.success : Colors.danger;
  return {
    line,
    areaTop: isPositive ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
    areaBottom: isPositive ? "rgba(16,185,129,0.0)" : "rgba(239,68,68,0.0)",
  };
};

const crosshairFor = (line) => ({
  mode: CrosshairMode.Magnet,
  vertLine: {
    color: line,
    width: 1,
    style: LineStyle.Dashed,
    labelBackgroundColor: line,
  },
  horzLine: {
    color: line,
    width: 1,
    style: LineStyle.Dashed,
    labelBackgroundColor: line,
  },
});

const ChartView = ({
  candles = EMPTY,
  livePrice = null,
  isPositive = true,
  loading = false,
  height = 220,
  chartType = "area",
  showVolume = true,
}) => {
  const containerRef = useRef(null);
  // { chart, main, type, last } for the currently mounted chart
  const handleRef = useRef(null);
  const livePriceRef = useRef(livePrice);
  const isPositiveRef = useRef(isPositive);
  const [errorMsg, setErrorMsg] = useState(null);

  isPositiveRef.current = isPositive;

  // Area mode: close-only line data
  const lineData = useMemo(() => {
    if (chartType !== "area") return EMPTY;
    return candles.map((c) => ({ time: c.time, value: c.close }));
  }, [candles, chartType]);

  // Candle mode: OHLC data
  const candleData = useMemo(() => {
    if (chartType !== "candles") return EMPTY;
    return candles.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
  }, [candles, chartType]);

  // Candle mode: colored volume bars
  const volumeData = useMemo(() => {
    if (chartType !== "candles" || !showVolume) return EMPTY;
    return candles.map((c) => ({
      time: c.time,
      value: c.volume ?? 0,
      color:
        c.close >= c.open ? "rgba(16,185,129,0.5)" : "rgba(239,68,68,0.5)",
    }));
  }, [candles, chartType, showVolume]);

  const hasData =
    chartType === "candles" ? candleData.length > 0 : lineData.length > 0;

  // Push a live tick into the last bar/point (same rules as the native
  // WebView's window.updatePrice).
  const applyLivePrice = (raw) => {
    const h = handleRef.current;
    const price = Number(raw);
    if (!h || !price || !isFinite(price)) return;
    try {
      if (h.type === "candles") {
        const l = h.last;
        const updated = {
          time: l.time,
          open: l.open,
          high: Math.max(l.high, price),
          low: Math.min(l.low, price),
          close: price,
        };
        h.last = updated;
        h.main.update(updated);
      } else {
        h.main.update({ time: h.last.time, value: price });
      }
    } catch (e) {
      // A bad tick must never take the chart down.
    }
  };

  // ── Build the chart whenever the data / mode changes ───────────────────────
  // (isPositive is deliberately NOT a dependency: a colour flip is applied
  //  in place below so the user's zoom/scroll isn't reset when the price
  //  crosses the previous close.)
  useEffect(() => {
    if (loading || !hasData) return undefined;
    const el = containerRef.current;
    if (!el) return undefined;

    const isCandles = chartType === "candles";
    const c = colorsFor(isPositiveRef.current);
    let chart;

    try {
      setErrorMsg(null);

      chart = createChart(el, {
        autoSize: true, // tracks the container (incl. rotation / "100%" modals)
        // Fallback sizes only used if ResizeObserver is unavailable.
        width: el.clientWidth || 300,
        height: el.clientHeight || 200,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: MUTED,
          fontSize: 10,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: {
            visible: isCandles,
            color: "rgba(148,163,184,0.08)",
          },
        },
        crosshair: crosshairFor(c.line),
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: isCandles
            ? { top: 0.08, bottom: showVolume ? 0.25 : 0.08 }
            : { top: 0.15, bottom: 0.1 },
          textColor: MUTED,
        },
        timeScale: {
          borderVisible: false,
          textColor: MUTED,
          timeVisible: true,
          secondsVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        // The compact card sits inside a scrolling page. Don't let it hijack
        // the mouse wheel or a vertical finger swipe, otherwise the page
        // can't be scrolled while the pointer/finger is over the chart.
        // The full-screen candle chart keeps full pan/zoom.
        handleScale: isCandles
          ? true
          : { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
        handleScroll: isCandles
          ? true
          : {
              mouseWheel: false,
              pressedMouseMove: true,
              horzTouchDrag: true,
              vertTouchDrag: false,
            },
      });

      let main;
      let last;

      if (isCandles) {
        main = chart.addCandlestickSeries({
          upColor: Colors.success,
          downColor: Colors.danger,
          borderVisible: false,
          wickUpColor: Colors.success,
          wickDownColor: Colors.danger,
        });
        main.setData(candleData);
        last = candleData[candleData.length - 1];

        if (showVolume) {
          const volume = chart.addHistogramSeries({
            priceFormat: { type: "volume" },
            priceScaleId: "volume",
          });
          chart.priceScale("volume").applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
          });
          volume.setData(volumeData);
        }
      } else {
        main = chart.addAreaSeries({
          lineColor: c.line,
          lineWidth: 2,
          topColor: c.areaTop,
          bottomColor: c.areaBottom,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 4,
          crosshairMarkerBorderColor: c.line,
          crosshairMarkerBackgroundColor: c.line,
          lastValueVisible: true,
          priceLineVisible: true,
          priceLineColor: c.line,
          priceLineWidth: 1,
          priceLineStyle: LineStyle.Dashed,
        });
        main.setData(lineData);
        last = lineData[lineData.length - 1];
      }

      chart.timeScale().fitContent();

      handleRef.current = {
        chart,
        main,
        type: isCandles ? "candles" : "area",
        last,
      };

      // Apply whatever the latest live price already is.
      applyLivePrice(livePriceRef.current);
    } catch (err) {
      setErrorMsg(err && err.message ? err.message : "unknown error");
      if (chart) {
        try {
          chart.remove();
        } catch (e) {
          /* ignore */
        }
      }
      handleRef.current = null;
      return undefined;
    }

    return () => {
      handleRef.current = null;
      try {
        chart.remove();
      } catch (e) {
        /* already disposed */
      }
    };
    // applyLivePrice only reads refs, so it is safe to leave out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasData, chartType, showVolume, lineData, candleData, volumeData]);

  // ── Live ticks ─────────────────────────────────────────────────────────────
  useEffect(() => {
    livePriceRef.current = livePrice;
    applyLivePrice(livePrice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePrice]);

  // ── Colour flip (green <-> red) applied in place ───────────────────────────
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    const c = colorsFor(isPositive);
    try {
      h.chart.applyOptions({ crosshair: crosshairFor(c.line) });
      if (h.type === "area") {
        h.main.applyOptions({
          lineColor: c.line,
          topColor: c.areaTop,
          bottomColor: c.areaBottom,
          crosshairMarkerBorderColor: c.line,
          crosshairMarkerBackgroundColor: c.line,
          priceLineColor: c.line,
        });
      }
    } catch (e) {
      /* chart may be mid-rebuild */
    }
  }, [isPositive]);

  if (loading) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <ActivityIndicator size="small" color={Colors.primary} />
      </View>
    );
  }

  const message = errorMsg
    ? `Chart error: ${errorMsg}`
    : !hasData
      ? "No data yet. Market may be closed."
      : null;

  return (
    <View style={{ height, width: "100%" }}>
      {/* Plain DOM node: lightweight-charts needs a real element to draw into. */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
      {message ? (
        <View style={styles.messageWrap}>
          <Text style={styles.message}>{message}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  placeholder: {
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  messageWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    pointerEvents: "none",
  },
  message: {
    fontSize: 13,
    color: MUTED,
    textAlign: "center",
  },
});

export default ChartView;
