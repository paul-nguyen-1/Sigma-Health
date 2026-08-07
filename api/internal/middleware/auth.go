package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

const LocalsUserID = "user_id"

// RequireAuth verifies a Supabase-issued HS256 JWT and stores the `sub`
// claim (the auth.users.id UUID) in c.Locals(LocalsUserID).
func RequireAuth(jwtSecret string) fiber.Handler {
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
			func(t *jwt.Token) (interface{}, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, fiber.NewError(fiber.StatusUnauthorized, "unexpected signing method")
				}
				return []byte(jwtSecret), nil
			},
			jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Name}),
		)
		if err != nil || !parsed.Valid {
			return fiber.NewError(fiber.StatusUnauthorized, "invalid token")
		}

		c.Locals(LocalsUserID, claims.Subject)
		return c.Next()
	}
}
