package middleware

import (
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

const LocalsUserID = "user_id"

// RequireAuth verifies a Supabase-issued ES256 JWT against the project's
// published JWKS and stores the `sub` claim (the auth.users.id UUID) in
// c.Locals(LocalsUserID).
func RequireAuth(kf keyfunc.Keyfunc) fiber.Handler {
	return func(c *fiber.Ctx) error {
		header := c.Get("Authorization")
		token := strings.TrimPrefix(header, "Bearer ")
		if token == "" || token == header {
			return fiber.NewError(fiber.StatusUnauthorized, "missing bearer token")
		}

		claims := jwt.RegisteredClaims{}
		parsed, err := jwt.ParseWithClaims(
			token,
			&claims,
			kf.Keyfunc,
			jwt.WithValidMethods([]string{jwt.SigningMethodES256.Name}),
		)
		if err != nil || !parsed.Valid {
			return fiber.NewError(fiber.StatusUnauthorized, "invalid token")
		}

		c.Locals(LocalsUserID, claims.Subject)
		return c.Next()
	}
}
