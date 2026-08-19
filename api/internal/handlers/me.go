package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"sigma-health-api/internal/middleware"
)

// Me reports the caller's onboarding/trust status. This can't be answered
// by RLS alone: a banned user can't be trusted to discover their own ban
// by querying moderation_bans (which has no RLS grants at all — see
// migrations/0008_rls.sql), so the client asks the API instead.
func Me(pool *pgxpool.Pool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, _ := c.Locals(middleware.LocalsUserID).(string)

		var profileComplete, phoneVerified, banned bool
		err := pool.QueryRow(c.Context(), `
			SELECT
				EXISTS (
					SELECT 1 FROM profiles
					WHERE id = $1 AND (home_gym_id IS NOT NULL OR home_park_id IS NOT NULL)
				),
				COALESCE((SELECT phone_verified_at IS NOT NULL FROM profiles WHERE id = $1), false),
				EXISTS (SELECT 1 FROM moderation_bans WHERE user_id = $1 AND lifted_at IS NULL)
		`, userID).Scan(&profileComplete, &phoneVerified, &banned)
		if err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "failed to load account status")
		}

		return c.JSON(fiber.Map{
			"user_id":          userID,
			"profile_complete": profileComplete,
			"phone_verified":   phoneVerified,
			"banned":           banned,
		})
	}
}
