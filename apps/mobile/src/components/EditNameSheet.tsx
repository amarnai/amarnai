import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space, fontSize } from '@amarnai/tokens';
import type { ApiClient } from '@amarnai/api-client';
import { SheetLayout } from './SheetLayout';
import { FormInput } from './FormInput';
import { PrimaryButton } from './PrimaryButton';
import { toUserMessage } from '../errors';

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
      await client.updateMe({ name: trimmed });
      await onSaved();
      onClose();
    } catch (err) {
      setError(toUserMessage(err, 'Could not update name. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetLayout visible={visible} onClose={onClose} title="Display name" keyboardAvoiding>
      <View style={styles.body}>
        <FormInput
          value={name}
          onChangeText={(v) => { setName(v); setError(null); }}
          placeholder="Your name"
          maxLength={100}
          editable={!saving}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => void handleSave()}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <PrimaryButton
          label="Save"
          onPress={() => void handleSave()}
          disabled={!dirty}
          loading={saving}
        />
      </View>
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.danger,
  },
});
