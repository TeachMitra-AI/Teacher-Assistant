// Native port of client/src/components/AddMenu.tsx — the "+" button at the
// left of the Composer's controls row and the menu it opens. Two actions,
// same as web: Capture Photo (camera) and Upload File/Photo (an image or PDF
// from the device). Web owns two hidden <input type="file"> elements and this
// menu just clicks one of them; there is no DOM-input equivalent on native,
// so this component calls the OS pickers itself (expo-image-picker's camera,
// expo-document-picker for "any of our allowed types") and hands the result
// straight to `onAdd` — the Composer's useAttachments().add.
//
// Presented as a bottom sheet (Modal-over-Pressable-backdrop, the same
// convention ProfileMenu.tsx/TeachingContextMenu.tsx use) rather than an
// anchored popover — a composer-row button sits at the very bottom of the
// screen, where a popover above it would collide with the keyboard.
import React, { useState } from 'react';
import { View, Pressable, Modal, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Plus, Camera, ImagePlus } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { ALLOWED_ATTACHMENT_MIME_TYPES } from '../../config';
import type { PickedFile } from '../../lib/useAttachments';

interface AddMenuProps {
  onAdd: (files: PickedFile[]) => void;
  disabled?: boolean;
  /** True once MAX_ATTACHMENTS_COUNT files are staged — the button stays visible but refuses to add more. */
  atMax?: boolean;
}

export function AddMenu({ onAdd, disabled = false, atMax = false }: AddMenuProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  async function capturePhoto() {
    setOpen(false);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access in your device Settings to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    onAdd([{
      uri: asset.uri,
      name: asset.fileName || `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType || 'image/jpeg',
      size: asset.fileSize ?? 0,
    }]);
  }

  async function uploadFile() {
    setOpen(false);
    const result = await DocumentPicker.getDocumentAsync({
      type: ALLOWED_ATTACHMENT_MIME_TYPES,
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets) return;
    onAdd(result.assets.map((a) => ({
      uri: a.uri,
      name: a.name,
      mimeType: a.mimeType || 'application/octet-stream',
      size: a.size ?? 0,
    })));
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled || atMax}
        accessibilityRole="button"
        accessibilityLabel="Add to your question"
        testID="composer-add-menu"
        style={[styles.btn, { backgroundColor: colors.surface2, borderColor: colors.border }, (disabled || atMax) && styles.btnDisabled]}
      >
        <Plus size={18} color={colors.text} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)} accessibilityLabel="Close">
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.sheet,
              { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: insets.bottom + spacing.md },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <MenuRow icon={Camera} label="Capture Photo" description="Take a photo of a page, board or notebook" onPress={capturePhoto} />
            <MenuRow icon={ImagePlus} label="Upload File/Photo" description="Choose an image or PDF from this device" onPress={uploadFile} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuRow({
  icon: Icon, label, description, onPress,
}: {
  icon: typeof Camera;
  label: string;
  description: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: colors.orangeSoft }]}>
        <Icon size={18} color={colors.orange} />
      </View>
      <View style={styles.rowText}>
        <ThemedText style={styles.rowLabel}>{label}</ThemedText>
        <ThemedText variant="muted" style={styles.rowDesc}>{description}</ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 34, height: 34, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  overlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth, borderBottomWidth: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowDesc: { fontSize: 12 },
});
