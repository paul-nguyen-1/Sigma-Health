import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { ScreenContainer } from '../../components/ScreenContainer';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { theme } from '../../theme';
import { supabase } from '../../lib/supabase';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'ProfileSetup'>;

export function ProfileSetupScreen({ navigation }: Props) {
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('display_name, bio, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        setDisplayName(data.display_name ?? '');
        setBio(data.bio ?? '');
        setAvatarUrl(data.avatar_url);
      }
      setIsLoading(false);
    }
    load();
  }, []);

  async function handlePickAvatar() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!result.canceled && result.assets[0]) {
      setAvatarUri(result.assets[0].uri);
    }
  }

  async function handleContinue() {
    setError(null);
    setIsSubmitting(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsSubmitting(false);
      return;
    }

    let uploadedAvatarUrl = avatarUrl;
    if (avatarUri) {
      const ext = avatarUri.split('.').pop() ?? 'jpg';
      const path = `${user.id}/avatar.${ext}`;
      const response = await fetch(avatarUri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
      if (uploadError) {
        setError(uploadError.message);
        setIsSubmitting(false);
        return;
      }
      uploadedAvatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
    }

    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: user.id,
      display_name: displayName.trim(),
      bio: bio.trim() || null,
      avatar_url: uploadedAvatarUrl,
    });
    if (upsertError) {
      setError(upsertError.message);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    navigation.navigate('HomeLocation');
  }

  if (isLoading) {
    return <ScreenContainer>{null}</ScreenContainer>;
  }

  const previewUri = avatarUri ?? avatarUrl;

  return (
    <ScreenContainer>
      <Text style={styles.title}>Set up your profile</Text>
      <View style={styles.spacer} />
      <Pressable onPress={handlePickAvatar} style={styles.avatarPicker}>
        {previewUri ? (
          <Image source={{ uri: previewUri }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarPlaceholderLabel}>Add photo</Text>
          </View>
        )}
      </Pressable>
      <View style={styles.spacer} />
      <TextField label="Display name" value={displayName} onChangeText={setDisplayName} />
      <TextField
        label="Bio (optional)"
        value={bio}
        onChangeText={setBio}
        multiline
        style={styles.bioInput}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.spacer} />
      <Button
        label={isSubmitting ? 'Saving…' : 'Continue'}
        onPress={handleContinue}
        disabled={isSubmitting || displayName.trim().length === 0}
      />
      <View style={styles.spacerSmall} />
      <Button label="Back" variant="secondary" onPress={() => navigation.goBack()} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: theme.typography.size.xxl,
    fontWeight: theme.typography.weight.bold,
    color: theme.colors.text,
  },
  spacer: {
    height: theme.spacing.lg,
  },
  spacerSmall: {
    height: theme.spacing.sm,
  },
  avatarPicker: {
    alignSelf: 'center',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarPlaceholder: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPlaceholderLabel: {
    fontSize: theme.typography.size.xs,
    color: theme.colors.textMuted,
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  error: {
    color: theme.colors.danger,
    fontSize: theme.typography.size.sm,
    marginBottom: theme.spacing.sm,
  },
});
