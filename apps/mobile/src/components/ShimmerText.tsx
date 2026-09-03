import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

const MUTED = "rgba(236,236,241,0.44)";
const HIGHLIGHT = "rgba(255,255,255,0.98)";

function ShimmerGlyph({ character, index, length, progress }: { character: string; index: number; length: number; progress: SharedValue<number> }) {
  const center = (index + 1) / (length + 1);
  const animatedStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, Math.max(0, center - 0.18), center, Math.min(1, center + 0.18), 1],
      [MUTED, MUTED, HIGHLIGHT, MUTED, MUTED],
    ),
  }));
  return <Animated.Text style={[styles.text, animatedStyle]}>{character}</Animated.Text>;
}

export function ShimmerText({ children }: { children: string }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [progress]);

  const characters = [...children];
  return (
    <View accessible accessibilityLabel={children} accessibilityRole="text" style={styles.row}>
      {characters.map((character, index) => <ShimmerGlyph character={character} index={index} key={`${character}-${index}`} length={characters.length} progress={progress} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  text: { fontSize: 14, lineHeight: 20, letterSpacing: 0.14 },
});
