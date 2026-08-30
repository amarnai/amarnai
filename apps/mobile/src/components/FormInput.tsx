import { forwardRef } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { colors, fontSize, radii, space } from '@aziru/tokens';

export const FormInput = forwardRef<TextInput, TextInputProps>(function FormInput(
  { style, ...props },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      style={[styles.input, style]}
      placeholderTextColor={colors.ink4}
      {...props}
    />
  );
});

const styles = StyleSheet.create({
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
});
