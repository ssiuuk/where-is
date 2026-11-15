// Package migrations creates the Where Is collections and access rules.
package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Rules shared by the household-scoped collections (places, items).
const (
	memberRule   = `@request.auth.household != "" && household = @request.auth.household`
	createRule   = `@request.auth.household != "" && @request.body.household = @request.auth.household`
	updateRule   = memberRule + ` && (@request.body.household:isset = false || @request.body.household = @request.auth.household)`
	noHousehold  = `@request.body.household:isset = false`
	userSelfRule = `id = @request.auth.id`
)

func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		// households -------------------------------------------------
		households := core.NewBaseCollection("households")
		households.Fields.Add(
			&core.TextField{Name: "name", Required: true, Max: 80},
			&core.TextField{Name: "invite_code", Required: true, Max: 32},
			&core.RelationField{Name: "owner", CollectionId: users.Id, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		households.AddIndex("idx_households_invite_code", true, "invite_code", "")
		// households are created and joined through /api/whereis/* only
		households.ListRule = types.Pointer(`id = @request.auth.household`)
		households.ViewRule = types.Pointer(`id = @request.auth.household`)
		households.UpdateRule = types.Pointer(`id = @request.auth.household && @request.body.invite_code:isset = false && @request.body.owner:isset = false`)
		if err := app.Save(households); err != nil {
			return err
		}

		// users: which household they belong to ----------------------
		users.Fields.Add(&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1})
		users.ListRule = types.Pointer(userSelfRule + ` || (@request.auth.household != "" && household = @request.auth.household)`)
		users.ViewRule = users.ListRule
		users.CreateRule = types.Pointer(noHousehold)
		users.UpdateRule = types.Pointer(userSelfRule + ` && ` + noHousehold)
		users.OAuth2.MappedFields.Name = "name"
		users.OAuth2.MappedFields.AvatarURL = "avatar"
		if err := app.Save(users); err != nil {
			return err
		}

		// places -----------------------------------------------------
		places := core.NewBaseCollection("places")
		places.Fields.Add(
			&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "name", Required: true, Max: 100},
			&core.TextField{Name: "note", Max: 1000},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		setRules(places)
		if err := app.Save(places); err != nil {
			return err
		}
		// self relation needs the collection id, so it's added after the first save
		places.Fields.Add(&core.RelationField{Name: "parent", CollectionId: places.Id, MaxSelect: 1})
		places.AddIndex("idx_places_household", false, "household", "")
		if err := app.Save(places); err != nil {
			return err
		}

		// items ------------------------------------------------------
		items := core.NewBaseCollection("items")
		items.Fields.Add(
			&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "name", Required: true, Max: 120},
			&core.TextField{Name: "note", Max: 2000},
			&core.FileField{
				Name:      "photo",
				MaxSelect: 1,
				MaxSize:   10 << 20,
				MimeTypes: []string{"image/jpeg", "image/png", "image/webp", "image/heic"},
				Thumbs:    []string{"200x200", "800x0"},
			},
			&core.RelationField{Name: "place", CollectionId: places.Id, MaxSelect: 1},
			&core.RelationField{Name: "moved_by", CollectionId: users.Id, MaxSelect: 1},
			&core.DateField{Name: "moved_at"},
			&core.AutodateField{Name: "created", OnCreate: true},
			&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true},
		)
		items.AddIndex("idx_items_household", false, "household", "")
		items.AddIndex("idx_items_place", false, "place", "")
		setRules(items)
		if err := app.Save(items); err != nil {
			return err
		}

		// moves: the history of where an item has been, written by the server
		moves := core.NewBaseCollection("moves")
		moves.Fields.Add(
			&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "item", CollectionId: items.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "from_place", CollectionId: places.Id, MaxSelect: 1},
			&core.RelationField{Name: "to_place", CollectionId: places.Id, MaxSelect: 1},
			&core.RelationField{Name: "by", CollectionId: users.Id, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		moves.AddIndex("idx_moves_item", false, "item", "")
		moves.ListRule = types.Pointer(memberRule)
		moves.ViewRule = types.Pointer(memberRule)
		if err := app.Save(moves); err != nil {
			return err
		}

		// settings ---------------------------------------------------
		settings := app.Settings()
		settings.Meta.AppName = "Where Is"
		// the server runs behind Caddy (see docker-compose.yml)
		settings.TrustedProxy.Headers = []string{"X-Forwarded-For"}
		// PocketBase's default limits cover sign-in and record creation;
		// add one for guessing invite codes
		settings.RateLimits.Enabled = true
		if _, ok := settings.RateLimits.FindRateLimitRule([]string{"/api/whereis/join"}); !ok {
			settings.RateLimits.Rules = append(settings.RateLimits.Rules,
				core.RateLimitRule{Label: "/api/whereis/join", Duration: 60, MaxRequests: 10})
		}
		return app.Save(settings)
	}, nil)
}

func setRules(c *core.Collection) {
	c.ListRule = types.Pointer(memberRule)
	c.ViewRule = types.Pointer(memberRule)
	c.CreateRule = types.Pointer(createRule)
	c.UpdateRule = types.Pointer(updateRule)
	c.DeleteRule = types.Pointer(memberRule)
}
