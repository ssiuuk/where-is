package main

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The app can be used on one phone with no server. When that phone later
// connects to a server, it uploads what it holds with POST
// /api/whereis/import-phone into the signed-in member's household. Records
// keep the ids they had on the phone, so QR labels and NFC stickers made
// while offline (whereis://p/<id>) keep working. Photos follow one by one
// as ordinary item updates.
//
// The upload is all or nothing, and safe to repeat: a record that is already
// in this household (from an earlier, interrupted upload) is left as it is.

const (
	maxPhonePlaces = 5000
	maxPhoneItems  = 20000
	maxPhoneMoves  = 100000
)

type phonePlace struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Note    string `json:"note"`
	Parent  string `json:"parent"`
	LabelAt string `json:"label_at"`
	NfcAt   string `json:"nfc_at"`
}

type phoneItem struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Note    string   `json:"note"`
	Tags    []string `json:"tags"`
	Aliases []string `json:"aliases"`
	Place   string   `json:"place"`
	MovedAt string   `json:"moved_at"`
}

type phoneMove struct {
	ID        string `json:"id"`
	Item      string `json:"item"`
	FromPlace string `json:"from_place"`
	ToPlace   string `json:"to_place"`
	FromName  string `json:"from_name"`
	ToName    string `json:"to_name"`
	Created   string `json:"created"`
}

type phoneImport struct {
	Places []phonePlace `json:"places"`
	Items  []phoneItem  `json:"items"`
	Moves  []phoneMove  `json:"moves"`
}

type phoneImportResult struct {
	Places  int `json:"places"`
	Items   int `json:"items"`
	Moves   int `json:"moves"`
	Skipped int `json:"skipped"`
}

func importPhone(e *core.RequestEvent) error {
	var body phoneImport
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid upload.", err)
	}
	if len(body.Places) > maxPhonePlaces || len(body.Items) > maxPhoneItems || len(body.Moves) > maxPhoneMoves {
		return e.BadRequestError(fmt.Sprintf("Too much to upload at once (up to %d places and %d items).", maxPhonePlaces, maxPhoneItems), nil)
	}
	user, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return err
	}
	household := user.GetString("household")
	if household == "" {
		return e.BadRequestError("You don't belong to a household yet.", nil)
	}

	var res phoneImportResult
	err = e.App.RunInTransaction(func(tx core.App) error {
		r, err := savePhoneImport(tx, household, user.Id, body)
		res = r
		return err
	})
	if err != nil {
		var apiErr *router.ApiError
		if errors.As(err, &apiErr) {
			return apiErr
		}
		return e.BadRequestError("Couldn't upload. Nothing was changed. "+err.Error(), nil)
	}
	if res.Places+res.Items > 0 {
		logActivity(e.App, household, user.Id, "imported", "item", "", "From a phone",
			fmt.Sprintf("%d items, %d places", res.Items, res.Places))
	}
	return e.JSON(http.StatusOK, res)
}

// inHousehold reports whether a record with this id exists, and whether it
// belongs to the household. It fails when the id is taken by another household.
func inHousehold(app core.App, collection, id, household string) (bool, error) {
	if id == "" {
		return false, errors.New("a record has no id")
	}
	r, err := app.FindRecordById(collection, id)
	if err != nil {
		return false, nil
	}
	if r.GetString("household") != household {
		return false, router.NewBadRequestError("Some of these were already uploaded to a different household. Nothing was changed.", nil)
	}
	return true, nil
}

func savePhoneImport(app core.App, household, by string, body phoneImport) (phoneImportResult, error) {
	var res phoneImportResult
	placesCol, err := app.FindCollectionByNameOrId("places")
	if err != nil {
		return res, err
	}
	itemsCol, err := app.FindCollectionByNameOrId("items")
	if err != nil {
		return res, err
	}
	movesCol, err := app.FindCollectionByNameOrId("moves")
	if err != nil {
		return res, err
	}

	// places: parents first. A place whose parent is missing (or that is in a
	// loop) ends up at the top level rather than failing the whole upload.
	known := map[string]bool{} // place ids that exist in the household now
	pending := []phonePlace{}
	for _, p := range body.Places {
		exists, err := inHousehold(app, "places", p.ID, household)
		if err != nil {
			return res, err
		}
		if exists {
			known[p.ID] = true
			res.Skipped++
			continue
		}
		pending = append(pending, p)
	}
	parentOK := func(id string) bool {
		if id == "" || known[id] {
			return true
		}
		ok, _ := inHousehold(app, "places", id, household)
		return ok
	}
	for len(pending) > 0 {
		next := pending[:0:0]
		for _, p := range pending {
			if !parentOK(p.Parent) {
				next = append(next, p)
				continue
			}
			if err := savePhonePlace(app, placesCol, household, p, p.Parent); err != nil {
				return res, err
			}
			known[p.ID] = true
			res.Places++
		}
		if len(next) == len(pending) {
			// what's left points at places that will never arrive
			for _, p := range next {
				if err := savePhonePlace(app, placesCol, household, p, ""); err != nil {
					return res, err
				}
				known[p.ID] = true
				res.Places++
			}
			next = nil
		}
		pending = next
	}
	placeOK := func(id string) string {
		if id != "" && parentOK(id) {
			return id
		}
		return ""
	}

	// items, without photos
	items := map[string]bool{}
	for _, it := range body.Items {
		exists, err := inHousehold(app, "items", it.ID, household)
		if err != nil {
			return res, err
		}
		items[it.ID] = true
		if exists {
			res.Skipped++
			continue
		}
		r := core.NewRecord(itemsCol)
		r.Id = it.ID
		r.Set("household", household)
		r.Set("name", it.Name)
		r.Set("note", it.Note)
		r.Set("tags", nonNil(it.Tags))
		r.Set("aliases", nonNil(it.Aliases))
		r.Set("place", placeOK(it.Place))
		if it.MovedAt != "" {
			if at, err := types.ParseDateTime(it.MovedAt); err == nil {
				r.Set("moved_by", by)
				r.Set("moved_at", at)
			}
		}
		if err := app.Save(r); err != nil {
			return res, fmt.Errorf("item %q: %w", it.Name, err)
		}
		res.Items++
	}

	// history, as it happened on the phone, now under the uploader's name
	for _, m := range body.Moves {
		if !items[m.Item] {
			continue
		}
		exists, err := inHousehold(app, "moves", m.ID, household)
		if err != nil {
			return res, err
		}
		if exists {
			res.Skipped++
			continue
		}
		r := core.NewRecord(movesCol)
		r.Id = m.ID
		r.Set("household", household)
		r.Set("item", m.Item)
		r.Set("from_place", placeOK(m.FromPlace))
		r.Set("to_place", placeOK(m.ToPlace))
		r.Set("from_name", m.FromName)
		r.Set("to_name", m.ToName)
		r.Set("by", by)
		if at, err := types.ParseDateTime(m.Created); err == nil && !at.IsZero() {
			r.SetRaw("created", at)
		}
		if err := app.Save(r); err != nil {
			return res, fmt.Errorf("history: %w", err)
		}
		res.Moves++
	}
	return res, nil
}

func savePhonePlace(app core.App, col *core.Collection, household string, p phonePlace, parent string) error {
	r := core.NewRecord(col)
	r.Id = p.ID
	r.Set("household", household)
	r.Set("name", p.Name)
	r.Set("note", p.Note)
	r.Set("parent", parent)
	if p.LabelAt != "" {
		r.Set("label_at", p.LabelAt)
	}
	if p.NfcAt != "" {
		r.Set("nfc_at", p.NfcAt)
	}
	if err := app.Save(r); err != nil {
		return fmt.Errorf("place %q: %w", p.Name, err)
	}
	return nil
}

func nonNil(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}
