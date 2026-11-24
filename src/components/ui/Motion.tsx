import { Check, ChevronDown } from 'lucide-react-native';
import React, { useEffect } from 'react';
import {
  Pressable,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutUp,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { THEME_COLORS } from '../../lib/theme';

export const SPRING_PRESS_IN = {
  damping: 18,
  stiffness: 420,
  mass: 0.6,
} as const;

export const SPRING_PRESS_OUT = {
  damping: 15,
  stiffness: 320,
  mass: 0.65,
} as const;

export const LAYOUT_SPRING = LinearTransition.springify()
  .damping(22)
  .stiffness(210)
  .mass(0.8);

export { LayoutAnimationConfig };

/** Props for the spring-animated `MotionPressable` interactive wrapper. */
export interface MotionPressableProps extends PressableProps {
  children: React.ReactNode;
  scaleTo?: number;
  pressOpacity?: number;
  className?: string;
  containerStyle?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
  flex?: boolean;
}

/**
 * Tactile Pressable with gentle spring scale-down and bounce-back feedback.
 * Respects OS reduced-motion settings automatically.
 */
export function MotionPressable({
  children,
  scaleTo = 0.97,
  pressOpacity = 0.92,
  disabled = false,
  className = '',
  style,
  containerStyle,
  fullWidth = false,
  flex = false,
  onPressIn,
  onPressOut,
  ...pressableProps
}: MotionPressableProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const handlePressIn = (event: GestureResponderEvent) => {
    if (!disabled) {
      if (reducedMotion) {
        opacity.value = withTiming(pressOpacity, { duration: 80 });
      } else {
        scale.value = withSpring(scaleTo, SPRING_PRESS_IN);
        opacity.value = withTiming(pressOpacity, { duration: 90 });
      }
    }
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    if (reducedMotion) {
      opacity.value = withTiming(1, { duration: 100 });
    } else {
      scale.value = withSpring(1, SPRING_PRESS_OUT);
      opacity.value = withTiming(1, { duration: 140 });
    }
    onPressOut?.(event);
  };

  return (
    <Animated.View
      style={[
        flex ? { flex: 1 } : undefined,
        fullWidth ? { width: '100%' } : undefined,
        containerStyle,
        animatedStyle,
      ]}
    >
      <Pressable
        disabled={disabled}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        className={className}
        style={style}
        {...pressableProps}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** Props for `AnimatedBlockShell` wrapping each collaborative block on the Room Board. */
export interface AnimatedBlockShellProps {
  children: React.ReactNode;
  isNewlyAdded?: boolean;
  onHighlightEnd?: () => void;
}

/**
 * Wraps a room block with smooth spring insertion/reflow and a warm tangerine halo
 * pulse whenever the user adds a new block to the board.
 */
export function AnimatedBlockShell({
  children,
  isNewlyAdded = false,
  onHighlightEnd,
}: AnimatedBlockShellProps) {
  const reducedMotion = useReducedMotion();
  const glowOpacity = useSharedValue(0);
  const popScale = useSharedValue(1);

  useEffect(() => {
    if (!isNewlyAdded) {
      return undefined;
    }

    if (reducedMotion) {
      glowOpacity.value = withSequence(
        withTiming(0.85, { duration: 180 }),
        withDelay(500, withTiming(0, { duration: 400 })),
      );
    } else {
      popScale.value = 0.95;
      popScale.value = withSequence(
        withSpring(1.015, { damping: 14, stiffness: 260, mass: 0.75 }),
        withSpring(1, { damping: 16, stiffness: 240, mass: 0.8 }),
      );
      glowOpacity.value = withSequence(
        withTiming(1, { duration: 240, easing: Easing.out(Easing.quad) }),
        withDelay(
          650,
          withTiming(0, { duration: 650, easing: Easing.inOut(Easing.quad) }),
        ),
      );
    }

    if (onHighlightEnd) {
      const timer = setTimeout(onHighlightEnd, 1600);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isNewlyAdded, reducedMotion, glowOpacity, popScale, onHighlightEnd]);

  const shellScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: popScale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  return (
    <Animated.View
      entering={
        reducedMotion
          ? FadeIn.duration(180)
          : FadeInDown.duration(320).springify().damping(18).stiffness(195)
      }
      exiting={reducedMotion ? FadeOut.duration(150) : FadeOutUp.duration(220)}
      layout={reducedMotion ? undefined : LAYOUT_SPRING}
      style={shellScaleStyle}
    >
      <View className="relative">
        {children}
        {isNewlyAdded ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 14,
                borderRadius: 22,
                borderWidth: 2,
                borderColor: THEME_COLORS.primary,
                backgroundColor: 'rgba(224, 90, 43, 0.06)',
              },
              glowStyle,
            ]}
          />
        ) : null}
      </View>
    </Animated.View>
  );
}

/** Props for `AnimatedItemRow` wrapping dynamic items inside blocks. */
export interface AnimatedItemRowProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Smoothly animates newly added or removed items inside a block (poll options,
 * tasks, schedule nodes, expenses) with gentle reflow.
 */
export function AnimatedItemRow({ children, style }: AnimatedItemRowProps) {
  const reducedMotion = useReducedMotion();

  return (
    <Animated.View
      entering={
        reducedMotion
          ? FadeIn.duration(140)
          : FadeInDown.duration(240).springify().damping(20).stiffness(230)
      }
      exiting={reducedMotion ? FadeOut.duration(120) : FadeOutUp.duration(180)}
      layout={reducedMotion ? undefined : LAYOUT_SPRING}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

/** Props for smooth width-interpolated progress bars. */
export interface AnimatedProgressBarProps {
  percent: number;
  fillColor?: string;
  trackColor?: string;
  height?: number;
  variant?: 'track' | 'backgroundFill';
}

/**
 * Fluidly animates progress bar width on vote/task/budget updates instead of snapping.
 */
export function AnimatedProgressBar({
  percent,
  fillColor = THEME_COLORS.primary,
  trackColor = THEME_COLORS.lineSoft,
  height = 8,
  variant = 'track',
}: AnimatedProgressBarProps) {
  const reducedMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, percent));
  const widthProgress = useSharedValue(clamped);

  useEffect(() => {
    if (reducedMotion) {
      widthProgress.value = clamped;
    } else {
      widthProgress.value = withTiming(clamped, {
        duration: 380,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [clamped, reducedMotion, widthProgress]);

  const animatedFillStyle = useAnimatedStyle(() => ({
    width: `${widthProgress.value}%`,
  }));

  if (variant === 'backgroundFill') {
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            backgroundColor: fillColor,
          },
          animatedFillStyle,
        ]}
      />
    );
  }

  return (
    <View
      style={{
        height,
        width: '100%',
        overflow: 'hidden',
        borderRadius: 999,
        backgroundColor: trackColor,
      }}
    >
      <Animated.View
        style={[
          {
            height: '100%',
            borderRadius: 999,
            backgroundColor: fillColor,
          },
          animatedFillStyle,
        ]}
      />
    </View>
  );
}

/** Props for the spring-bouncing `AnimatedCheckBadge` selection dot. */
export interface AnimatedCheckBadgeProps {
  checked: boolean;
  size?: number;
  iconSize?: number;
  accentColor?: string;
}

/** Circular selection indicator that pops gently when activated. */
export function AnimatedCheckBadge({
  checked,
  size = 20,
  iconSize = 12,
  accentColor = THEME_COLORS.primary,
}: AnimatedCheckBadgeProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (checked && !reducedMotion) {
      scale.value = 0.72;
      scale.value = withSequence(
        withSpring(1.16, { damping: 12, stiffness: 360, mass: 0.55 }),
        withSpring(1, { damping: 16, stiffness: 280, mass: 0.65 }),
      );
    } else {
      scale.value = 1;
    }
  }, [checked, reducedMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: checked ? accentColor : '#D4CEC6',
          backgroundColor: checked ? accentColor : '#FFFFFF',
        },
        animatedStyle,
      ]}
    >
      {checked ? <Check size={iconSize} color="#FFFFFF" strokeWidth={3} /> : null}
    </Animated.View>
  );
}

/** Smoothly rotating chevron for collapsible panels (e.g., archived rooms). */
export function AnimatedChevron({
  expanded,
  size = 18,
  color = THEME_COLORS.inkMuted,
}: {
  expanded: boolean;
  size?: number;
  color?: string;
}) {
  const reducedMotion = useReducedMotion();
  const rotation = useSharedValue(expanded ? 180 : 0);

  useEffect(() => {
    rotation.value = reducedMotion
      ? expanded
        ? 180
        : 0
      : withSpring(expanded ? 180 : 0, {
          damping: 18,
          stiffness: 260,
          mass: 0.7,
        });
  }, [expanded, reducedMotion, rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <ChevronDown size={size} color={color} />
    </Animated.View>
  );
}

/** Gently animates conditional panel content when switching modes or expanding drawers. */
export function AnimatedPanelReveal({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <Animated.View
      entering={
        reducedMotion
          ? FadeIn.duration(120)
          : FadeInDown.duration(220).easing(Easing.out(Easing.cubic))
      }
      exiting={FadeOut.duration(140)}
      layout={reducedMotion ? undefined : LAYOUT_SPRING}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
