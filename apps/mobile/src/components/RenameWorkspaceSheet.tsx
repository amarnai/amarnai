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
  workspaceId: string;
  client: ApiClient;
  currentName: string;
  onRenamed: () => void | Promise<void>;
};

export function RenameWorkspaceSheet({
  visible,
  onClose,
  workspaceId,
  client,
  currentName,
  onRenamed,
}: Props) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the field to the current name each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setName(currentName);
    setError(null);
  }, [visible]);

  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== currentName;

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await client.updateWorkspace(workspaceId, trimmed);
      await onRenamed();
      onClose();
    } catch (err) {
      setError(toUserMessage(err, 'Could not rename workspace. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetLayout visible={visible} onClose={onClose} title="Workspace name" keyboardAvoiding>
      <View style={styles.body}>
        <FormInput
          value={name}
          onChangeText={(v) => { setName(v); setError(null); }}
          placeholder="Workspace name"
          maxLength={100}
          editable={!saving}
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
