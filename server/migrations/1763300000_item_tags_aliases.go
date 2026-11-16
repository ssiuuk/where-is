package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Items get tags (labels for grouping, like "tools" or "christmas") and
// aliases (other names the family uses for the same thing). Both are JSON
// lists of strings; the server tidies them on every save (see itemnames.go).
func init() {
	m.Register(func(app core.App) error {
		items, err := app.FindCollectionByNameOrId("items")
		if err != nil {
			return err
		}
		items.Fields.Add(
			&core.JSONField{Name: "tags", MaxSize: 4000},
			&core.JSONField{Name: "aliases", MaxSize: 4000},
		)
		return app.Save(items)
	}, func(app core.App) error {
		items, err := app.FindCollectionByNameOrId("items")
		if err != nil {
			return err
		}
		items.Fields.RemoveByName("tags")
		items.Fields.RemoveByName("aliases")
		return app.Save(items)
	})
}
