import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { colors, space, fontSize } from '@aziru/tokens';
import type { ApiClient } from '@aziru/api-client';
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
  const { i18n } = useLingui();
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
      setError(toUserMessage(err, i18n._(msg`Could not update name. Please try again.`)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetLayout visible={visible} onClose={onClose} title={i18n._(msg`Display name`)} keyboardAvoiding>
      <View style={styles.body}>
        <FormInput
          value={name}
          onChangeText={(v) => { setName(v); setError(null); }}
          placeholder={i18n._(msg`Your name`)}
          maxLength={100}
          editable={!saving}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => void handleSave()}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <PrimaryButton
          label={i18n._(msg`Save`)}
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
