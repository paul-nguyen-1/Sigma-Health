package integrationtest

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
)

// TestProfilesPublicViewExposesOnlySafeColumns confirms profiles_public
// (migration 0020) returns another user's identity columns but never their
// phone_number/expo_push_token -- profiles itself stays self-only (0008).
func TestProfilesPublicViewExposesOnlySafeColumns(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	if _, err := pool.Exec(ctx,
		"UPDATE profiles SET phone_number = '+15551234567', expo_push_token = 'ExponentPushToken[test]' WHERE id = $1", bob,
	); err != nil {
		t.Fatalf("fixture update: %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var displayName string
		if err := tx.QueryRow(context.Background(),
			"SELECT display_name FROM profiles_public WHERE id = $1", bob,
		).Scan(&displayName); err != nil {
			t.Fatalf("alice reading bob's display_name via profiles_public should succeed: %v", err)
		}
		if displayName != "Bob" {
			t.Errorf("expected display_name 'Bob', got %q", displayName)
		}

		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM information_schema.columns WHERE table_name = 'profiles_public' AND column_name IN ('phone_number', 'expo_push_token')",
		).Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 0 {
			t.Errorf("profiles_public should not expose phone_number/expo_push_token at all, found %d such columns", count)
		}

		var directCount int
		err := tx.QueryRow(context.Background(), "SELECT count(*) FROM profiles WHERE id = $1", bob).Scan(&directCount)
		if err != nil {
			t.Fatalf("select: %v", err)
		}
		if directCount != 0 {
			t.Errorf("querying profiles directly should still be self-only (0008) -- alice should see 0 rows for bob, saw %d", directCount)
		}
	})
}

// TestCheckInsActivePublic / TestCheckInsExpiredStillSelfOnly exercise the
// 0021 widening: another user's ACTIVE check-in is visible, but the same
// row becomes invisible to anyone but its owner once it expires.
func TestCheckInsActivePublic(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")
	gymID := "66666666-6666-6666-6666-666666666666"

	if _, err := pool.Exec(ctx,
		"INSERT INTO check_ins (user_id, location_type, location_id, expires_at) VALUES ($1, 'gym', $2, now() + interval '2 hours')",
		alice, gymID,
	); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, bob, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM check_ins WHERE user_id = $1", alice,
		).Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 1 {
			t.Errorf("bob should see alice's active check-in, saw %d rows", count)
		}
	})
}

func TestCheckInsExpiredStillSelfOnly(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")
	gymID := "77777777-7777-7777-7777-777777777777"

	if _, err := pool.Exec(ctx,
		"INSERT INTO check_ins (user_id, location_type, location_id, checked_in_at, expires_at) VALUES ($1, 'gym', $2, now() - interval '3 hours', now() - interval '1 hour')",
		alice, gymID,
	); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, bob, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM check_ins WHERE user_id = $1", alice,
		).Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 0 {
			t.Errorf("bob should NOT see alice's expired check-in, saw %d rows", count)
		}
	})

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM check_ins WHERE user_id = $1", alice,
		).Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 1 {
			t.Errorf("alice should still see her own expired check-in (self-only history, 0008), saw %d rows", count)
		}
	})
}

// TestConversationMembersNoRecursionError is the single most important new
// test in this phase: is_conversation_member (0021) exists specifically to
// avoid "infinite recursion detected in policy" -- assert a real query
// against conversation_members' SELECT policy doesn't raise it.
func TestConversationMembersNoRecursionError(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")
	carol := createUser(t, pool, "Carol")

	var groupID string
	asUserCommit(t, pool, alice, func(tx pgx.Tx) {
		if err := tx.QueryRow(context.Background(), "SELECT create_group($1)", "Test Group").Scan(&groupID); err != nil {
			t.Fatalf("alice creating a group should succeed: %v", err)
		}
	})
	if _, err := pool.Exec(ctx, "INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)", groupID, bob); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, bob, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM conversation_members WHERE conversation_id = $1", groupID,
		).Scan(&count); err != nil {
			t.Fatalf("bob querying conversation_members should not raise infinite recursion: %v", err)
		}
		if count != 2 {
			t.Errorf("bob should see both members (himself + alice) of a group he's in, saw %d", count)
		}
	})

	asUser(t, pool, carol, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM conversation_members WHERE conversation_id = $1", groupID,
		).Scan(&count); err != nil {
			t.Fatalf("carol querying conversation_members should not raise infinite recursion: %v", err)
		}
		if count != 0 {
			t.Errorf("carol (not a member) should see 0 rows for this group, saw %d", count)
		}
	})
}

// TestMessagesLocationReadHistoricalWriteRequiresActive exercises the
// presence-gated pattern's read/write asymmetry (0021 §0 Case 4): a user
// with only an expired check-in can still read a location conversation's
// messages, but can't post until they have an active one.
func TestMessagesLocationReadHistoricalWriteRequiresActive(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	gymID := "88888888-8888-8888-8888-888888888888"

	if _, err := pool.Exec(ctx,
		"INSERT INTO check_ins (user_id, location_type, location_id, checked_in_at, expires_at) VALUES ($1, 'gym', $2, now() - interval '5 days', now() - interval '4 days')",
		alice, gymID,
	); err != nil {
		t.Fatalf("fixture insert (expired-but-recent check-in): %v", err)
	}

	var conversationID string
	if err := pool.QueryRow(ctx, "SELECT get_or_create_location_conversation('gym', $1)", gymID).Scan(&conversationID); err != nil {
		t.Fatalf("get_or_create_location_conversation: %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM messages WHERE conversation_id = $1", conversationID,
		).Scan(&count); err != nil {
			t.Fatalf("alice reading a location channel from a gym she visited (expired) should succeed: %v", err)
		}
	})

	asUser(t, pool, alice, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, 'hi')", conversationID, alice,
		)
		if err == nil {
			t.Error("alice should NOT be able to post with only an expired check-in, but the insert succeeded")
		}
	})

	if _, err := pool.Exec(ctx,
		"INSERT INTO check_ins (user_id, location_type, location_id, expires_at) VALUES ($1, 'gym', $2, now() + interval '2 hours')",
		alice, gymID,
	); err != nil {
		t.Fatalf("fixture insert (active check-in): %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, 'hi')", conversationID, alice,
		)
		if err != nil {
			t.Errorf("alice posting with an active check-in should succeed: %v", err)
		}
	})
}

// TestMessagesDirectBlockedAfterExistingConversation confirms a block made
// mid-conversation stops new messages without the conversation itself
// disappearing from either party's view.
func TestMessagesDirectBlockedAfterExistingConversation(t *testing.T) {
	pool := testPool(t)
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	// These three steps use asUserCommit, not asUser: each one's effect
	// (the conversation existing, bob's first message, bob's block) must
	// durably persist for a LATER, separate asUser call to observe --
	// asUser always rolls back, which would silently make the conversation/
	// block never actually exist for the next step to react to.
	var conversationID string
	asUserCommit(t, pool, alice, func(tx pgx.Tx) {
		if err := tx.QueryRow(context.Background(), "SELECT start_direct_conversation($1)", bob).Scan(&conversationID); err != nil {
			t.Fatalf("alice starting a DM with bob should succeed: %v", err)
		}
	})

	asUserCommit(t, pool, bob, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, 'hey')", conversationID, bob,
		)
		if err != nil {
			t.Fatalf("bob messaging before any block should succeed: %v", err)
		}
	})

	asUserCommit(t, pool, bob, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(), "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)", bob, alice)
		if err != nil {
			t.Fatalf("bob blocking alice should succeed: %v", err)
		}
	})

	asUser(t, pool, alice, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1, $2, 'still there?')", conversationID, alice,
		)
		if err == nil {
			t.Error("alice should NOT be able to message bob after he blocked her, but the insert succeeded")
		}
	})

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM conversations WHERE id = $1", conversationID,
		).Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 1 {
			t.Errorf("the conversation itself should still be visible to alice after the block, saw %d rows", count)
		}
	})
}

// TestMatchGroupsNoDirectWrite confirms match_groups is readable-not-
// writable, same shape as user_plan_sessions -- only propose_match/the
// provisioning trigger ever write to it.
func TestMatchGroupsNoDirectWrite(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")

	var runningSportID, parkID string
	if err := pool.QueryRow(ctx, "SELECT id FROM sports WHERE slug = 'running'").Scan(&runningSportID); err != nil {
		t.Fatalf("lookup sport: %v", err)
	}
	if err := pool.QueryRow(ctx,
		"INSERT INTO parks (sport_id, name, lat, lng) VALUES ($1, 'Test Park', 0, 0) RETURNING id", runningSportID,
	).Scan(&parkID); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO match_groups (sport_id, park_id, pace_bucket) VALUES ($1, $2, 'sub_5_00')", runningSportID, parkID,
		)
		if err == nil {
			t.Error("a direct client insert into match_groups should be blocked (no write policy), but it succeeded")
		}
	})
}

// TestMatchParticipantsInvitedSelfOnlyRespond mirrors user_plan_sessions'
// "narrow self-UPDATE only, no client INSERT" shape: an invitee can accept/
// decline their own row, but can't respond on someone else's, and can't
// insert new rows directly.
func TestMatchParticipantsInvitedSelfOnlyRespond(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	var runningSportID, parkID, groupID string
	pool.QueryRow(ctx, "SELECT id FROM sports WHERE slug = 'running'").Scan(&runningSportID)
	pool.QueryRow(ctx, "INSERT INTO parks (sport_id, name, lat, lng) VALUES ($1, 'Test Park', 0, 0) RETURNING id", runningSportID).Scan(&parkID)
	if err := pool.QueryRow(ctx,
		"INSERT INTO match_groups (sport_id, park_id, pace_bucket) VALUES ($1, $2, 'sub_5_00') RETURNING id", runningSportID, parkID,
	).Scan(&groupID); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}
	if _, err := pool.Exec(ctx,
		"INSERT INTO match_participants (match_group_id, user_id, status) VALUES ($1, $2, 'invited')", groupID, alice,
	); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, bob, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(),
			"INSERT INTO match_participants (match_group_id, user_id, status) VALUES ($1, $2, 'invited')", groupID, bob,
		)
		if err == nil {
			t.Error("a direct client insert into match_participants should be blocked, but it succeeded")
		}
	})

	asUser(t, pool, bob, func(tx pgx.Tx) {
		result, err := tx.Exec(context.Background(),
			"UPDATE match_participants SET status = 'accepted' WHERE match_group_id = $1 AND user_id = $2", groupID, alice,
		)
		if err != nil {
			t.Fatalf("select/update should not error: %v", err)
		}
		if result.RowsAffected() != 0 {
			t.Error("bob should NOT be able to respond on alice's invitation, but a row was affected")
		}
	})

	asUser(t, pool, alice, func(tx pgx.Tx) {
		result, err := tx.Exec(context.Background(),
			"UPDATE match_participants SET status = 'accepted' WHERE match_group_id = $1 AND user_id = $2", groupID, alice,
		)
		if err != nil {
			t.Fatalf("alice accepting her own invitation should succeed: %v", err)
		}
		if result.RowsAffected() != 1 {
			t.Error("expected alice's own row to be updated")
		}
	})
}

// TestMatchParticipantsProvisionsConversationAtThreshold exercises
// provision_match_conversation (0022, extended with push in 0026): a
// conversation is created exactly once, only once 2 participants have
// accepted, and a later acceptance joins the same conversation rather than
// creating a duplicate.
func TestMatchParticipantsProvisionsConversationAtThreshold(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")
	carol := createUser(t, pool, "Carol")

	var runningSportID, parkID, groupID string
	pool.QueryRow(ctx, "SELECT id FROM sports WHERE slug = 'running'").Scan(&runningSportID)
	pool.QueryRow(ctx, "INSERT INTO parks (sport_id, name, lat, lng) VALUES ($1, 'Test Park', 0, 0) RETURNING id", runningSportID).Scan(&parkID)
	pool.QueryRow(ctx,
		"INSERT INTO match_groups (sport_id, park_id, pace_bucket) VALUES ($1, $2, 'sub_5_00') RETURNING id", runningSportID, parkID,
	).Scan(&groupID)

	if _, err := pool.Exec(ctx,
		"INSERT INTO match_participants (match_group_id, user_id, status) VALUES ($1, $2, 'accepted')", groupID, alice,
	); err != nil {
		t.Fatalf("fixture insert (founder, already accepted): %v", err)
	}
	if _, err := pool.Exec(ctx,
		"INSERT INTO match_participants (match_group_id, user_id, status) VALUES ($1, $2, 'invited'), ($1, $3, 'invited')", groupID, bob, carol,
	); err != nil {
		t.Fatalf("fixture insert (invitees): %v", err)
	}

	var conversationBefore *string
	if err := pool.QueryRow(ctx, "SELECT conversation_id FROM match_groups WHERE id = $1", groupID).Scan(&conversationBefore); err != nil {
		t.Fatalf("select: %v", err)
	}
	if conversationBefore != nil {
		t.Fatalf("expected no conversation before the threshold is crossed, got %v", *conversationBefore)
	}

	if _, err := pool.Exec(ctx, "UPDATE match_participants SET status = 'accepted' WHERE match_group_id = $1 AND user_id = $2", groupID, bob); err != nil {
		t.Fatalf("bob accepting (2nd, crosses threshold): %v", err)
	}

	var conversationID string
	if err := pool.QueryRow(ctx, "SELECT conversation_id FROM match_groups WHERE id = $1", groupID).Scan(&conversationID); err != nil {
		t.Fatalf("select: %v", err)
	}
	if conversationID == "" {
		t.Fatal("expected a conversation to be provisioned once 2 participants accepted")
	}

	var memberCount int
	pool.QueryRow(ctx, "SELECT count(*) FROM conversation_members WHERE conversation_id = $1", conversationID).Scan(&memberCount)
	if memberCount != 2 {
		t.Errorf("expected exactly 2 conversation_members (alice + bob) at threshold, got %d", memberCount)
	}

	if _, err := pool.Exec(ctx, "UPDATE match_participants SET status = 'accepted' WHERE match_group_id = $1 AND user_id = $2", groupID, carol); err != nil {
		t.Fatalf("carol accepting (3rd): %v", err)
	}

	var conversationAfterThird string
	pool.QueryRow(ctx, "SELECT conversation_id FROM match_groups WHERE id = $1", groupID).Scan(&conversationAfterThird)
	if conversationAfterThird != conversationID {
		t.Errorf("carol's later acceptance should join the SAME conversation, not create a new one: got %v, want %v", conversationAfterThird, conversationID)
	}

	pool.QueryRow(ctx, "SELECT count(*) FROM conversation_members WHERE conversation_id = $1", conversationID).Scan(&memberCount)
	if memberCount != 3 {
		t.Errorf("expected 3 conversation_members after carol joins, got %d", memberCount)
	}

	var totalConversations int
	pool.QueryRow(ctx, "SELECT count(*) FROM conversations WHERE id = $1", conversationID).Scan(&totalConversations)
	if totalConversations != 1 {
		t.Errorf("expected exactly 1 conversation row for this match, got %d", totalConversations)
	}
}

// TestFollowsPublicRead confirms follower/following visibility is public,
// matching sports/gyms/daily_sessions' shape -- not self-only.
func TestFollowsPublicRead(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")
	carol := createUser(t, pool, "Carol")

	// Fixture inserted via the superuser pool, not asUser -- asUser always
	// rolls back its transaction (see helpers_test.go), so a row inserted
	// there is invisible to a later, separate asUser call.
	if _, err := pool.Exec(ctx, "INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)", alice, bob); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, carol, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM follows WHERE follower_id = $1 AND followed_id = $2", alice, bob,
		).Scan(&count); err != nil {
			t.Fatalf("carol (an unrelated third party) reading follows should succeed: %v", err)
		}
		if count != 1 {
			t.Errorf("carol should see alice-follows-bob (public read), saw %d rows", count)
		}
	})
}

// TestFollowsBlocksAware confirms a follow attempt between two blocked
// users is rejected.
func TestFollowsBlocksAware(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	// Superuser pool, not asUser -- must persist for alice's later, separate
	// asUser call to see it.
	if _, err := pool.Exec(ctx, "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)", bob, alice); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		_, err := tx.Exec(context.Background(), "INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)", alice, bob)
		if err == nil {
			t.Error("alice should NOT be able to follow bob after he blocked her, but the insert succeeded")
		}
	})
}

// TestPersonalRecordsVisibleToFollowers / TestPersonalRecordsSelfOnlyStillEnforcedForNonFollowers
// and the runs equivalents are the pair Case 7 cares most about: every ALTER
// widening an existing policy needs a test proving the OLD case wasn't
// weakened, not just that the new case works.
func TestPersonalRecordsVisibleToFollowers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	if _, err := pool.Exec(ctx,
		"INSERT INTO personal_records (user_id, exercise_name, best_weight, best_reps) VALUES ($1, 'squat', 100, 5)", bob,
	); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)", alice, bob); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM personal_records WHERE user_id = $1", bob,
		).Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 1 {
			t.Errorf("alice (following bob) should see bob's personal_records, saw %d", count)
		}
	})
}

func TestPersonalRecordsSelfOnlyStillEnforcedForNonFollowers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	if _, err := pool.Exec(ctx,
		"INSERT INTO personal_records (user_id, exercise_name, best_weight, best_reps) VALUES ($1, 'squat', 100, 5)", bob,
	); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(),
			"SELECT count(*) FROM personal_records WHERE user_id = $1", bob,
		).Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 0 {
			t.Errorf("alice (NOT following bob) should see 0 of bob's personal_records, saw %d -- self-only was weakened", count)
		}
	})
}

func TestRunsVisibleToFollowers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	if _, err := pool.Exec(ctx, "INSERT INTO runs (user_id, distance_km, duration_seconds) VALUES ($1, 5, 1500)", bob); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2)", alice, bob); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(), "SELECT count(*) FROM runs WHERE user_id = $1", bob).Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 1 {
			t.Errorf("alice (following bob) should see bob's run, saw %d", count)
		}
	})
}

func TestRunsSelfOnlyStillEnforcedForNonFollowers(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	// Fixture must actually persist (superuser pool, not asUser -- see
	// TestFollowsPublicRead's comment) for this to be a meaningful
	// negative assertion rather than a vacuous "empty table" pass.
	if _, err := pool.Exec(ctx, "INSERT INTO runs (user_id, distance_km, duration_seconds) VALUES ($1, 5, 1500)", bob); err != nil {
		t.Fatalf("fixture insert: %v", err)
	}

	asUser(t, pool, alice, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(context.Background(), "SELECT count(*) FROM runs WHERE user_id = $1", bob).Scan(&count); err != nil {
			t.Fatalf("select: %v", err)
		}
		if count != 0 {
			t.Errorf("alice (NOT following bob) should see 0 of bob's runs, saw %d -- self-only was weakened", count)
		}
	})
}

// TestReferredByImmutableAfterFirstSet confirms the enforce_referred_by_immutable
// trigger (0025) rejects changing referred_by once it's set.
func TestReferredByImmutableAfterFirstSet(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")
	carol := createUser(t, pool, "Carol")

	if _, err := pool.Exec(ctx, "UPDATE profiles SET referred_by = $1 WHERE id = $2", bob, alice); err != nil {
		t.Fatalf("setting referred_by the first time should succeed: %v", err)
	}

	_, err := pool.Exec(ctx, "UPDATE profiles SET referred_by = $1 WHERE id = $2", carol, alice)
	if err == nil {
		t.Error("changing referred_by after it's already set should be rejected, but the update succeeded")
	}
}

// TestReferralCodeResolvable confirms resolve_referral_code (0025) can
// resolve a code without needing profiles' own self-only SELECT widened.
func TestReferralCodeResolvable(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	alice := createUser(t, pool, "Alice")
	bob := createUser(t, pool, "Bob")

	var code string
	if err := pool.QueryRow(ctx, "SELECT referral_code FROM profiles WHERE id = $1", alice).Scan(&code); err != nil {
		t.Fatalf("lookup alice's referral_code as superuser: %v", err)
	}

	asUser(t, pool, bob, func(tx pgx.Tx) {
		var resolved string
		if err := tx.QueryRow(context.Background(), "SELECT resolve_referral_code($1)", code).Scan(&resolved); err != nil {
			t.Fatalf("bob resolving alice's referral code should succeed: %v", err)
		}
		if resolved != alice.String() {
			t.Errorf("expected resolve_referral_code to return alice's id, got %v", resolved)
		}
	})
}
