import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { X } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
 * with dim backdrop, keyboard-aware resize behavior, and safe-area padding.
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
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      modalRef.current?.present();
    } else {
      modalRef.current?.dismiss();
    }
  }, [visible]);

  const renderBackdrop = useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...backdropProps}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        opacity={0.45}
      />
    ),
    [],
  );

  const bottomPadding = Math.max(insets.bottom, 16) + 12;

  return (
    <BottomSheetModal
      ref={modalRef}
      snapPoints={snapPoints}
      enableDynamicSizing={!snapPoints}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backdropComponent={renderBackdrop}
      onDismiss={onClose}
      handleIndicatorStyle={{ backgroundColor: '#D4D4D8', width: 40 }}
      backgroundStyle={{
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
    >
      {title ? (
        <View className="flex-row items-center justify-between border-b border-zinc-100 px-5 pb-3 pt-1">
          <Text className="text-lg font-bold text-ink">{title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭弹窗"
            onPress={() => modalRef.current?.dismiss()}
            className="h-8 w-8 items-center justify-center rounded-full bg-zinc-100 active:bg-zinc-200"
          >
            <X size={18} color="#52525B" />
          </Pressable>
        </View>
      ) : null}

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
