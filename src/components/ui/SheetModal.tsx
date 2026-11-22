import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { X } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  computeSheetMaxDynamicHeight,
  resolveSheetModalTransition,
} from '../../lib/sheetModalHelpers';
import { THEME_COLORS } from '../../lib/theme';
import { MotionPressable } from './Motion';

/** Props for the PopRoom `SheetModal` bottom-sheet wrapper. */
export interface SheetModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  snapPoints?: (string | number)[];
  scrollable?: boolean;
  children: React.ReactNode;
}

/**
 * Declarative wrapper around `@gorhom/bottom-sheet`'s `BottomSheetModal`
 * with warm milky-white surface, gentle dimmed backdrop, tactile close button,
 * and keyboard-aware resize behavior.
 */
export function SheetModal({
  visible,
  onClose,
  title,
  snapPoints,
  scrollable = true,
  children,
}: SheetModalProps) {
  const modalRef = useRef<BottomSheetModal>(null);
  const isPresentedRef = useRef(false);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  useEffect(() => {
    const { command, nextPresented } = resolveSheetModalTransition({
      visible,
      isPresented: isPresentedRef.current,
    });
    isPresentedRef.current = nextPresented;

    if (command === 'present') {
      modalRef.current?.present();
    } else if (command === 'dismiss') {
      modalRef.current?.dismiss();
    }
  }, [visible]);

  const handleModalDismiss = useCallback(() => {
    isPresentedRef.current = false;
    onClose();
  }, [onClose]);

  const handleRequestClose = useCallback(() => {
    if (isPresentedRef.current) {
      isPresentedRef.current = false;
      modalRef.current?.dismiss();
    } else {
      onClose();
    }
  }, [onClose]);

  const renderBackdrop = useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...backdropProps}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        opacity={0.34}
      />
    ),
    [],
  );

  const renderHandle = useCallback(() => {
    return (
      <View className="rounded-t-[28px] bg-white">
        <View className="items-center pb-2 pt-3">
          <View className="h-1 w-10 rounded-full bg-primaryBorder" />
        </View>
        {title ? (
          <View className="flex-row items-center justify-between border-b border-lineSoft px-5 pb-3.5 pt-1">
            <Text className="text-[17px] font-bold text-ink">{title}</Text>
            <MotionPressable
              accessibilityRole="button"
              accessibilityLabel="关闭弹窗"
              onPress={handleRequestClose}
              scaleTo={0.9}
              className="h-8 w-8 items-center justify-center rounded-full bg-surface"
            >
              <X size={17} color={THEME_COLORS.inkMuted} />
            </MotionPressable>
          </View>
        ) : null}
      </View>
    );
  }, [title, handleRequestClose]);

  const bottomPadding = Math.max(insets.bottom, 16) + 12;
  const topInset = insets.top + 8;
  const maxDynamicContentSize = snapPoints
    ? undefined
    : computeSheetMaxDynamicHeight(windowHeight, topInset);

  return (
    <BottomSheetModal
      ref={modalRef}
      snapPoints={snapPoints}
      enableDynamicSizing={!snapPoints}
      maxDynamicContentSize={maxDynamicContentSize}
      topInset={topInset}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backdropComponent={renderBackdrop}
      handleComponent={renderHandle}
      onDismiss={handleModalDismiss}
      backgroundStyle={{
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
      }}
    >
      {scrollable ? (
        <BottomSheetScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: bottomPadding,
          }}
        >
          {children}
        </BottomSheetScrollView>
      ) : (
        <BottomSheetView
          style={{
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: bottomPadding,
          }}
        >
          {children}
        </BottomSheetView>
      )}
    </BottomSheetModal>
  );
}
