package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The admin panel: disabled accounts, last activity, invite on/off,
// label tracking, the recycle bin, the activity log and server settings.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		households, err := app.FindCollectionByNameOrId("households")
		if err != nil {
			return err
		}
		places, err := app.FindCollectionByNameOrId("places")
		if err != nil {
			return err
		}

		// users: a site admin can turn an account off; last_active is set
		// by the server when someone signs in or the app reconnects
		users.Fields.Add(
			&core.BoolField{Name: "disabled"},
			&core.DateField{Name: "last_active"},
		)
		users.UpdateRule = types.Pointer(userSelfRule + ` && ` + noHousehold +
			` && @request.body.disabled:isset = false && @request.body.last_active:isset = false`)
		if err := app.Save(users); err != nil {
			return err
		}

		// households: the family admin can stop new people joining
		households.Fields.Add(&core.BoolField{Name: "invites_off"})
		households.UpdateRule = types.Pointer(`id = @request.auth.household && @request.body.invite_code:isset = false && @request.body.owner:isset = false && @request.body.invites_off:isset = false`)
		if err := app.Save(households); err != nil {
			return err
		}

		// places: when a QR label was printed or an NFC sticker written
		places.Fields.Add(
			&core.DateField{Name: "label_at"},
			&core.DateField{Name: "nfc_at"},
		)
		if err := app.Save(places); err != nil {
			return err
		}

		// trash: deleted items and places, kept for 30 days. Only the
		// server reads and writes it (no API rules).
		trash := core.NewBaseCollection("trash")
		trash.Fields.Add(
			&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.TextField{Name: "kind", Required: true, Max: 10}, // item or place
			&core.TextField{Name: "record", Required: true, Max: 30},
			&core.TextField{Name: "name", Max: 200},
			&core.TextField{Name: "place_name", Max: 1000},
			&core.JSONField{Name: "data", MaxSize: 1 << 20},
			&core.FileField{Name: "photo", Protected: true, MaxSelect: 1, MaxSize: 10 << 20},
			&core.RelationField{Name: "by", CollectionId: users.Id, MaxSelect: 1},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		trash.AddIndex("idx_trash_household", false, "household, created", "")
		if err := app.Save(trash); err != nil {
			return err
		}

		// activity: who added, changed, moved or deleted what
		activity := core.NewBaseCollection("activity")
		activity.Fields.Add(
			&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1, Required: true, CascadeDelete: true},
			&core.RelationField{Name: "by", CollectionId: users.Id, MaxSelect: 1},
			&core.TextField{Name: "action", Required: true, Max: 20},
			&core.TextField{Name: "kind", Max: 10},
			&core.TextField{Name: "record", Max: 30},
			&core.TextField{Name: "name", Max: 200},
			&core.TextField{Name: "detail", Max: 1000},
			&core.AutodateField{Name: "created", OnCreate: true},
		)
		activity.AddIndex("idx_activity_household", false, "household, created", "")
		if err := app.Save(activity); err != nil {
			return err
		}

		// server settings changed from the admin screens (sign-up, Google)
		cfg := core.NewBaseCollection("server_settings")
		cfg.Fields.Add(
			&core.TextField{Name: "key", Required: true, Max: 50},
			&core.JSONField{Name: "value", MaxSize: 10000},
		)
		cfg.AddIndex("idx_server_settings_key", true, "key", "")
		return app.Save(cfg)
	}, nil)
}
