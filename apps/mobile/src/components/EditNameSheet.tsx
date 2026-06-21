import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, fontSize, fontWeight, radii } from '@amarnai/tokens';
import type { ApiClient } from '@amarnai/api-client';
import { BottomSheet } from './BottomSheet';

type Props = {
  visible: boolean;
  onClose: () => void;
  client: ApiClient;
  currentName: string | null;
  onSaved: () => void | Promise<void>;
};

export function EditNameSheet({ visible, onClose, client, currentName, onSaved }: Props) {
  const [name, setName] = useState(currentName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(currentName ?? '');
    setError(null);
  }, [visible, currentName]);

  const trimmed = name.trim();
  const dirty = trimmed !== (currentName ?? '');

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await client.updateMe(trimmed);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update name');
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} keyboardAvoiding>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Display name</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={colors.ink3} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(v) => { setName(v); setError(null); }}
            placeholder="Your name"
            placeholderTextColor={colors.ink4}
            maxLength={100}
            editable={!saving}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => void handleSave()}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.saveBtn, (!dirty || saving) && styles.btnDisabled]}
            onPress={() => void handleSave()}
            disabled={!dirty || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line2,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.ink,
  },
  body: {
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line2,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: fontSize.lg,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.danger,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  saveBtnText: {
    color: colors.surface,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
