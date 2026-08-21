import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ConversationsInboxScreen } from '../screens/community/ConversationsInboxScreen';
import { ChatScreen } from '../screens/community/ChatScreen';
import { CreateGroupScreen } from '../screens/community/CreateGroupScreen';
import { JoinGroupScreen } from '../screens/community/JoinGroupScreen';

// direct/group only for now -- location channels and matching (Weeks
// 3/4 per .claude.roadmap.phase3.md §7) aren't wired into the UI yet.
export type CommunityStackParamList = {
  ConversationsInbox: undefined;
  Chat: { conversationId: string };
  CreateGroup: undefined;
  JoinGroup: undefined;
};

const Stack = createNativeStackNavigator<CommunityStackParamList>();

export function CommunityStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ConversationsInbox" component={ConversationsInboxScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="CreateGroup" component={CreateGroupScreen} />
      <Stack.Screen name="JoinGroup" component={JoinGroupScreen} />
    </Stack.Navigator>
  );
}
