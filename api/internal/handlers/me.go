package handlers

import (
	"github.com/gofiber/fiber/v2"

	"sigma-health-api/internal/middleware"
)

func Me(c *fiber.Ctx) error {
	userID, _ := c.Locals(middleware.LocalsUserID).(string)
	return c.JSON(fiber.Map{"user_id": userID})
}
