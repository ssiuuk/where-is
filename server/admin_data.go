package main

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/tools/types"
)

// ---------------------------------------------------------------------
// CSV export and import

func exportCSV(e *core.RequestEvent) error {
	h := familyOf(e)
	kind := e.Request.PathValue("kind")
	places, err := e.App.FindAllRecords("places", dbx.HashExp{"household": h.Id})
	if err != nil {
		return err
	}
	paths := placePaths(places)

	var buf bytes.Buffer
	buf.WriteString("\uFEFF") // so Excel reads the file as UTF-8
	w := csv.NewWriter(&buf)
	switch kind {
	case "items.csv":
		items, err := e.App.FindRecordsByFilter("items", "household = {:h}", "name", 0, 0, dbx.Params{"h": h.Id})
		if err != nil {
			return err
		}
		_ = w.Write([]string{"name", "place", "note", "moved_at", "id"})
		for _, it := range items {
			_ = w.Write([]string{it.GetString("name"), paths[it.GetString("place")], it.GetString("note"), it.GetString("moved_at"), it.Id})
		}
	case "places.csv":
		_ = w.Write([]string{"place", "note", "label_printed", "nfc_written", "id"})
		sort.Slice(places, func(i, j int) bool { return paths[places[i].Id] < paths[places[j].Id] })
		for _, p := range places {
			_ = w.Write([]string{paths[p.Id], p.GetString("note"), p.GetString("label_at"), p.GetString("nfc_at"), p.Id})
		}
	default:
		return e.NotFoundError("Export items.csv or places.csv.", nil)
	}
	w.Flush()
	e.Response.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="where-is-%s"`, kind))
	return e.Blob(http.StatusOK, "text/csv; charset=utf-8", buf.Bytes())
}

// placePaths maps every place id to its full name, like "Garage › Shelf 3".
func placePaths(places []*core.Record) map[string]string {
	byID := map[string]*core.Record{}
	for _, p := range places {
		byID[p.Id] = p
	}
	out := map[string]string{}
	for _, p := range places {
		var names []string
		seen := map[string]bool{}
		for cur := p; cur != nil && !seen[cur.Id]; cur = byID[cur.GetString("parent")] {
			seen[cur.Id] = true
			names = append([]string{cur.GetString("name")}, names...)
		}
		out[p.Id] = strings.Join(names, " › ")
	}
	return out
}

// splitPlacePath reads "Garage > Shelf 3" or "Garage › Shelf 3".
func splitPlacePath(s string) []string {
	s = strings.ReplaceAll(s, "›", ">")
	var out []string
	for _, part := range strings.Split(s, ">") {
		if part = strings.Join(strings.Fields(part), " "); part != "" {
			out = append(out, part)
		}
	}
	return out
}

func normName(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

type importResult struct {
	Items   int `json:"items"`
	Places  int `json:"places"`
	Skipped int `json:"skipped"`
}

var errDryRun = errors.New("dry run")

// importCSV adds items or places from CSV text. Places are named by path
// ("Garage > Shelf 3") and created when missing. An item already in the
// same place with the same name is skipped, so importing twice is safe.
// With dryRun it only reports what it would do.
func importCSV(e *core.RequestEvent) error {
	var body struct {
		Kind   string `json:"kind"` // items or places
		CSV    string `json:"csv"`
		DryRun bool   `json:"dryRun"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request.", err)
	}
	if body.Kind != "items" && body.Kind != "places" {
		return e.BadRequestError("Import items or places.", nil)
	}
	r := csv.NewReader(strings.NewReader(strings.TrimPrefix(body.CSV, "\uFEFF")))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	r.TrimLeadingSpace = true
	rows, err := r.ReadAll()
	if err != nil {
		return e.BadRequestError("That isn't valid CSV: "+err.Error(), nil)
	}
	if len(rows) < 2 {
		return e.BadRequestError("Paste a header row (like name,place,note) and at least one row under it.", nil)
	}
	if len(rows) > 5001 {
		return e.BadRequestError("Import at most 5000 rows at a time.", nil)
	}
	col := map[string]int{}
	for i, name := range rows[0] {
		col[normName(name)] = i
	}
	get := func(row []string, names ...string) string {
		for _, n := range names {
			if i, ok := col[n]; ok && i < len(row) {
				return strings.TrimSpace(row[i])
			}
		}
		return ""
	}
	if body.Kind == "items" {
		if _, ok := col["name"]; !ok {
			return e.BadRequestError(`The header row needs a "name" column (and optionally "place" and "note").`, nil)
		}
	} else if _, ok := col["place"]; !ok {
		if _, ok := col["path"]; !ok {
			if _, ok := col["name"]; !ok {
				return e.BadRequestError(`The header row needs a "place" column (and optionally "note").`, nil)
			}
		}
	}

	h := familyOf(e)
	var res importResult
	err = e.App.RunInTransaction(func(tx core.App) error {
		placeCol, err := tx.FindCollectionByNameOrId("places")
		if err != nil {
			return err
		}
		itemCol, err := tx.FindCollectionByNameOrId("items")
		if err != nil {
			return err
		}
		// (parent id, lowercased name) -> place id
		known := map[[2]string]string{}
		existing, err := tx.FindAllRecords("places", dbx.HashExp{"household": h.Id})
		if err != nil {
			return err
		}
		for _, p := range existing {
			known[[2]string{p.GetString("parent"), normName(p.GetString("name"))}] = p.Id
		}
		ensure := func(path []string) (string, error) {
			parent := ""
			for _, name := range path {
				key := [2]string{parent, normName(name)}
				if id, ok := known[key]; ok {
					parent = id
					continue
				}
				p := core.NewRecord(placeCol)
				p.Set("household", h.Id)
				p.Set("name", truncate(name, 100))
				p.Set("parent", parent)
				if err := tx.Save(p); err != nil {
					return "", err
				}
				known[key] = p.Id
				parent = p.Id
				res.Places++
			}
			return parent, nil
		}
		itemsAt := map[[2]string]bool{}
		if body.Kind == "items" {
			current, err := tx.FindAllRecords("items", dbx.HashExp{"household": h.Id})
			if err != nil {
				return err
			}
			for _, it := range current {
				itemsAt[[2]string{it.GetString("place"), normName(it.GetString("name"))}] = true
			}
		}

		for n, row := range rows[1:] {
			line := n + 2
			if body.Kind == "places" {
				path := splitPlacePath(get(row, "place", "path", "name"))
				if len(path) == 0 {
					res.Skipped++
					continue
				}
				before := res.Places
				id, err := ensure(path)
				if err != nil {
					return fmt.Errorf("line %d: %w", line, err)
				}
				if note := get(row, "note"); note != "" && res.Places > before {
					p, err := tx.FindRecordById("places", id)
					if err == nil {
						p.Set("note", truncate(note, 1000))
						if err := tx.Save(p); err != nil {
							return fmt.Errorf("line %d: %w", line, err)
						}
					}
				}
				if res.Places == before {
					res.Skipped++
				}
				continue
			}

			name := get(row, "name")
			if name == "" {
				res.Skipped++
				continue
			}
			place := ""
			if path := splitPlacePath(get(row, "place", "location")); len(path) > 0 {
				if place, err = ensure(path); err != nil {
					return fmt.Errorf("line %d: %w", line, err)
				}
			}
			key := [2]string{place, normName(name)}
			if itemsAt[key] {
				res.Skipped++
				continue
			}
			itemsAt[key] = true
			it := core.NewRecord(itemCol)
			it.Set("household", h.Id)
			it.Set("name", truncate(name, 120))
			it.Set("note", truncate(get(row, "note", "notes"), 2000))
			it.Set("place", place)
			if place != "" {
				it.Set("moved_by", e.Auth.Id)
				it.Set("moved_at", types.NowDateTime())
			}
			if err := tx.Save(it); err != nil {
				return fmt.Errorf("line %d (%s): %w", line, name, err)
			}
			res.Items++
		}
		if body.DryRun {
			return errDryRun // roll everything back
		}
		logActivity(tx, h.Id, e.Auth.Id, "imported", body.Kind, "", "", fmt.Sprintf("%d items, %d places", res.Items, res.Places))
		return nil
	})
	if err != nil && !errors.Is(err, errDryRun) {
		return e.BadRequestError("Nothing was imported. "+err.Error(), nil)
	}
	return e.JSON(http.StatusOK, res)
}

// ---------------------------------------------------------------------
// duplicates and merging

type dupRecord struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Place   string `json:"place"`
	Note    string `json:"note"`
	Photo   bool   `json:"photo"`
	Items   int    `json:"items,omitempty"`
	Updated string `json:"updated"`
}

// findDuplicates groups items with the same name, and places with the same
// name inside the same place.
func findDuplicates(e *core.RequestEvent) error {
	h := familyOf(e)
	places, err := e.App.FindAllRecords("places", dbx.HashExp{"household": h.Id})
	if err != nil {
		return err
	}
	items, err := e.App.FindAllRecords("items", dbx.HashExp{"household": h.Id})
	if err != nil {
		return err
	}
	paths := placePaths(places)
	inPlace := map[string]int{}
	for _, it := range items {
		inPlace[it.GetString("place")]++
	}

	group := func(recs []*core.Record, key func(*core.Record) string, info func(*core.Record) dupRecord) [][]dupRecord {
		groups := map[string][]dupRecord{}
		var order []string
		for _, r := range recs {
			k := key(r)
			if _, ok := groups[k]; !ok {
				order = append(order, k)
			}
			groups[k] = append(groups[k], info(r))
		}
		sort.Strings(order)
		out := [][]dupRecord{}
		for _, k := range order {
			if len(groups[k]) > 1 {
				out = append(out, groups[k])
			}
		}
		return out
	}
	return e.JSON(http.StatusOK, map[string]any{
		"items": group(items, func(r *core.Record) string { return normName(r.GetString("name")) }, func(r *core.Record) dupRecord {
			return dupRecord{ID: r.Id, Name: r.GetString("name"), Place: paths[r.GetString("place")], Note: r.GetString("note"),
				Photo: r.GetString("photo") != "", Updated: r.GetString("updated")}
		}),
		"places": group(places, func(r *core.Record) string { return r.GetString("parent") + "/" + normName(r.GetString("name")) }, func(r *core.Record) dupRecord {
			return dupRecord{ID: r.Id, Name: r.GetString("name"), Place: paths[r.Id], Note: r.GetString("note"),
				Items: inPlace[r.Id], Updated: r.GetString("updated")}
		}),
	})
}

// mergeRecords folds duplicates into the one to keep. For items the history
// moves over and notes are joined; for places the items and places inside
// move over. The merged-away records go to the recycle bin.
func mergeRecords(e *core.RequestEvent) error {
	var body struct {
		Kind  string   `json:"kind"`
		Keep  string   `json:"keep"`
		Merge []string `json:"merge"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request.", err)
	}
	if body.Kind != "items" && body.Kind != "places" {
		return e.BadRequestError("Merge items or places.", nil)
	}
	if len(body.Merge) == 0 || len(body.Merge) > 50 {
		return e.BadRequestError("Choose between 1 and 50 records to merge.", nil)
	}
	h := familyOf(e)
	err := e.App.RunInTransaction(func(tx core.App) error {
		keep, err := tx.FindRecordById(body.Kind, body.Keep)
		if err != nil || keep.GetString("household") != h.Id {
			return e.NotFoundError("The one to keep isn't in your household.", nil)
		}
		for _, id := range body.Merge {
			if id == keep.Id {
				continue
			}
			src, err := tx.FindRecordById(body.Kind, id)
			if err != nil || src.GetString("household") != h.Id {
				return e.NotFoundError("One of those isn't in your household. Nothing was merged.", nil)
			}
			if body.Kind == "items" {
				err = mergeItem(tx, keep, src)
			} else {
				err = mergePlace(tx, keep, src)
			}
			if err != nil {
				return err
			}
			if err := moveToTrash(tx, src, e.Auth.Id); err != nil {
				return err
			}
			if err := tx.Delete(src); err != nil {
				return err
			}
			logActivity(tx, h.Id, e.Auth.Id, "merged", kindOf(keep), keep.Id, keep.GetString("name"), "merged in "+src.GetString("name"))
		}
		return nil
	})
	if err != nil {
		var apiErr *router.ApiError
		if errors.As(err, &apiErr) {
			return apiErr
		}
		return e.BadRequestError("Couldn't merge them. Nothing changed. "+err.Error(), nil)
	}
	return e.NoContent(http.StatusNoContent)
}

func mergeItem(tx core.App, keep, src *core.Record) error {
	if note := strings.TrimSpace(src.GetString("note")); note != "" && !strings.Contains(keep.GetString("note"), note) {
		joined := strings.TrimSpace(keep.GetString("note") + "\n" + note)
		keep.Set("note", truncate(joined, 2000))
	}
	if keep.GetString("photo") == "" && src.GetString("photo") != "" {
		if f, err := readStoredFile(tx, src, src.GetString("photo")); err == nil {
			keep.Set("photo", f)
		}
	}
	if err := tx.Save(keep); err != nil {
		return err
	}
	// the history follows the item that stays
	_, err := tx.DB().Update("moves", dbx.Params{"item": keep.Id}, dbx.HashExp{"item": src.Id}).Execute()
	return err
}

func mergePlace(tx core.App, keep, src *core.Record) error {
	// keeping a place that sits inside the one going away: lift it out first
	for id, seen := keep.GetString("parent"), 0; id != "" && seen < 100; seen++ {
		if id == src.Id {
			keep.Set("parent", src.GetString("parent"))
			if err := tx.Save(keep); err != nil {
				return err
			}
			break
		}
		p, err := tx.FindRecordById("places", id)
		if err != nil {
			break
		}
		id = p.GetString("parent")
	}
	children, err := tx.FindAllRecords("places", dbx.HashExp{"parent": src.Id})
	if err != nil {
		return err
	}
	for _, c := range children {
		if c.Id == keep.Id {
			continue
		}
		c.Set("parent", keep.Id)
		if err := tx.Save(c); err != nil {
			return err
		}
	}
	items, err := tx.FindAllRecords("items", dbx.HashExp{"place": src.Id})
	if err != nil {
		return err
	}
	for _, it := range items {
		it.Set("place", keep.Id)
		if err := tx.Save(it); err != nil {
			return err
		}
	}
	if keep.GetString("note") == "" && src.GetString("note") != "" {
		keep.Set("note", src.GetString("note"))
		return tx.Save(keep)
	}
	return nil
}

// errFileGone means the stored file no longer exists, so there is nothing
// left to keep (unlike a read error, which might pass).
var errFileGone = errors.New("the file is gone")

// readStoredFile copies a record's stored file into memory, so it can be
// attached to another record even after the original is deleted.
// It is a variable so tests can make reading fail.
var readStoredFile = func(app core.App, rec *core.Record, name string) (*filesystem.File, error) {
	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, err
	}
	defer fsys.Close()
	key := rec.BaseFilesPath() + "/" + name
	if ok, err := fsys.Exists(key); err == nil && !ok {
		return nil, errFileGone
	}
	r, err := fsys.GetReader(key)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	b, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	return filesystem.NewFileFromBytes(b, name)
}

// ---------------------------------------------------------------------
// recycle bin

// moveToTrash keeps a copy of an item or place (and an item's photo and
// history) before it is deleted.
func moveToTrash(app core.App, rec *core.Record, by string) error {
	col, err := app.FindCachedCollectionByNameOrId("trash")
	if err != nil {
		return err
	}
	t := core.NewRecord(col)
	t.Set("household", rec.GetString("household"))
	t.Set("kind", kindOf(rec))
	t.Set("record", rec.Id)
	t.Set("name", truncate(rec.GetString("name"), 200))
	t.Set("by", by)
	data := map[string]any{"fields": rec.FieldsData()}
	if kindOf(rec) == "item" {
		t.Set("place_name", placePathName(app, rec.GetString("place")))
		moves, err := app.FindAllRecords("moves", dbx.HashExp{"item": rec.Id})
		if err != nil {
			return err
		}
		history := make([]map[string]any, 0, len(moves))
		for _, m := range moves {
			history = append(history, m.FieldsData())
		}
		data["moves"] = history
		if photo := rec.GetString("photo"); photo != "" {
			// the bin must be able to give the photo back: if it can't be
			// copied, the delete fails rather than lose it
			f, err := readStoredFile(app, rec, photo)
			switch {
			case err == nil:
				t.Set("photo", f)
			case errors.Is(err, errFileGone):
				app.Logger().Warn("deleted item's photo was already missing", "item", rec.Id)
			default:
				return fmt.Errorf("couldn't keep the item's photo in the recycle bin, so it wasn't deleted: %w", err)
			}
		}
	} else {
		t.Set("place_name", placePathName(app, rec.GetString("parent")))
	}
	t.Set("data", data)
	return app.Save(t)
}

func listTrash(e *core.RequestEvent) error {
	h := familyOf(e)
	rows, err := e.App.FindRecordsByFilter("trash", "household = {:h}", "-created", 200, 0, dbx.Params{"h": h.Id})
	if err != nil {
		return err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		by := ""
		if u, err := e.App.FindRecordById("users", r.GetString("by")); err == nil {
			by = displayName(u)
		}
		out = append(out, map[string]any{
			"id": r.Id, "kind": r.GetString("kind"), "name": r.GetString("name"), "place": r.GetString("place_name"),
			"photo": r.GetString("photo") != "", "by": by, "created": r.GetString("created"),
		})
	}
	return e.JSON(http.StatusOK, map[string]any{"items": out, "days": trashDays})
}

func trashEntry(e *core.RequestEvent) (*core.Record, error) {
	t, err := e.App.FindRecordById("trash", e.Request.PathValue("id"))
	if err != nil || t.GetString("household") != familyOf(e).Id {
		return nil, e.NotFoundError("That isn't in the recycle bin any more.", nil)
	}
	return t, nil
}

func restoreTrash(e *core.RequestEvent) error {
	t, err := trashEntry(e)
	if err != nil {
		return err
	}
	err = e.App.RunInTransaction(func(tx core.App) error {
		if err := restoreRecord(tx, t); err != nil {
			return err
		}
		logActivity(tx, t.GetString("household"), e.Auth.Id, "restored", t.GetString("kind"), t.GetString("record"), t.GetString("name"), "")
		return tx.Delete(t)
	})
	if err != nil {
		return e.BadRequestError("Couldn't restore it. "+err.Error(), nil)
	}
	return e.NoContent(http.StatusNoContent)
}

// restoreRecord puts a deleted item or place back with its old id, so labels
// and links to it work again. A place it was in that has since gone is
// left empty.
func restoreRecord(tx core.App, t *core.Record) error {
	var data struct {
		Fields map[string]any   `json:"fields"`
		Moves  []map[string]any `json:"moves"`
	}
	if err := t.UnmarshalJSONField("data", &data); err != nil {
		return err
	}
	collection := "items"
	parentField := "place"
	if t.GetString("kind") == "place" {
		collection = "places"
		parentField = "parent"
	}
	if _, err := tx.FindRecordById(collection, t.GetString("record")); err == nil {
		return errors.New("it already exists")
	}
	col, err := tx.FindCollectionByNameOrId(collection)
	if err != nil {
		return err
	}
	household := t.GetString("household")
	exists := func(collection, id string) bool {
		if id == "" {
			return false
		}
		r, err := tx.FindRecordById(collection, id)
		return err == nil && (collection == "users" || r.GetString("household") == household)
	}

	r := core.NewRecord(col)
	r.Id = t.GetString("record")
	for k, v := range data.Fields {
		switch k {
		case "id", "photo", "updated":
			continue
		}
		r.Set(k, v)
	}
	r.Set("household", household)
	if !exists("places", r.GetString(parentField)) {
		r.Set(parentField, "")
	}
	if collection == "items" && !exists("users", r.GetString("moved_by")) {
		r.Set("moved_by", "")
	}
	if created, ok := data.Fields["created"].(string); ok && created != "" {
		if dt, err := types.ParseDateTime(created); err == nil {
			r.SetRaw("created", dt)
		}
	}
	if photo := t.GetString("photo"); photo != "" && collection == "items" {
		// same the other way: don't empty the bin entry without its photo
		f, err := readStoredFile(tx, t, photo)
		switch {
		case err == nil:
			r.Set("photo", f)
		case !errors.Is(err, errFileGone):
			return fmt.Errorf("couldn't read the photo back: %w", err)
		}
	}
	if err := tx.Save(r); err != nil {
		return err
	}

	movesCol, err := tx.FindCollectionByNameOrId("moves")
	if err != nil {
		return err
	}
	for _, m := range data.Moves {
		mr := core.NewRecord(movesCol)
		for k, v := range m {
			if k != "created" {
				mr.Set(k, v)
			}
		}
		mr.Set("item", r.Id)
		mr.Set("household", household)
		for _, f := range []string{"from_place", "to_place"} {
			if !exists("places", mr.GetString(f)) {
				mr.Set(f, "")
			}
		}
		if !exists("users", mr.GetString("by")) {
			mr.Set("by", "")
		}
		if created, ok := m["created"].(string); ok {
			if dt, err := types.ParseDateTime(created); err == nil {
				mr.SetRaw("created", dt)
			}
		}
		if _, err := tx.FindRecordById("moves", mr.Id); err == nil {
			continue
		}
		if err := tx.Save(mr); err != nil {
			return err
		}
	}
	return nil
}

func deleteTrash(e *core.RequestEvent) error {
	t, err := trashEntry(e)
	if err != nil {
		return err
	}
	if err := e.App.Delete(t); err != nil {
		return e.InternalServerError("Couldn't delete it.", err)
	}
	return e.NoContent(http.StatusNoContent)
}

func emptyOldTrash(app core.App, before time.Time) {
	old, err := app.FindRecordsByFilter("trash", "created < {:t}", "", 500, 0, dbx.Params{"t": before.UTC().Format(types.DefaultDateLayout)})
	if err != nil {
		app.Logger().Warn("couldn't empty the recycle bin", "error", err)
		return
	}
	for _, t := range old {
		if err := app.Delete(t); err != nil {
			app.Logger().Warn("couldn't empty the recycle bin", "error", err)
		}
	}
}

// ---------------------------------------------------------------------
// stats

func familyStats(e *core.RequestEvent) error {
	h := familyOf(e)
	count := func(collection string, exp dbx.Expression) int64 {
		n, _ := e.App.CountRecords(collection, exp)
		return n
	}
	hx := dbx.HashExp{"household": h.Id}
	items, err := e.App.FindAllRecords("items", hx)
	if err != nil {
		return err
	}
	places, err := e.App.FindAllRecords("places", hx)
	if err != nil {
		return err
	}
	paths := placePaths(places)

	// photo storage: originals plus their thumbnails
	ids := map[string]bool{}
	withPhoto, noPlace := 0, 0
	for _, it := range items {
		ids[it.Id] = true
		if it.GetString("photo") != "" {
			withPhoto++
		}
		if it.GetString("place") == "" {
			noPlace++
		}
	}
	var photoBytes int64
	if col, err := e.App.FindCachedCollectionByNameOrId("items"); err == nil {
		if fsys, err := e.App.NewFilesystem(); err == nil {
			if objs, err := fsys.List(col.Id + "/"); err == nil {
				for _, o := range objs {
					parts := strings.Split(o.Key, "/")
					if len(parts) > 1 && ids[parts[1]] {
						photoBytes += o.Size
					}
				}
			}
			fsys.Close()
		}
	}

	unlabeled := 0
	for _, p := range places {
		if p.GetString("label_at") == "" && p.GetString("nfc_at") == "" {
			unlabeled++
		}
	}

	// items nobody has moved (or added) for a long time
	cutoff := time.Now().AddDate(-1, 0, 0)
	type staleItem struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Place string `json:"place"`
		Since string `json:"since"`
	}
	stale := []staleItem{}
	for _, it := range items {
		since := it.GetDateTime("moved_at")
		if since.IsZero() {
			since = it.GetDateTime("created")
		}
		if since.Time().Before(cutoff) {
			stale = append(stale, staleItem{it.Id, it.GetString("name"), paths[it.GetString("place")], since.String()})
		}
	}
	sort.Slice(stale, func(i, j int) bool { return stale[i].Since < stale[j].Since })
	staleTotal := len(stale)
	if len(stale) > 50 {
		stale = stale[:50]
	}

	weekAgo := types.NowDateTime().AddDate(0, 0, -7).String()
	return e.JSON(http.StatusOK, map[string]any{
		"items":           len(items),
		"places":          len(places),
		"members":         count("users", dbx.HashExp{"household": h.Id}),
		"withPhoto":       withPhoto,
		"noPlace":         noPlace,
		"photoBytes":      photoBytes,
		"unlabeled":       unlabeled,
		"trash":           count("trash", hx),
		"changesThisWeek": count("activity", dbx.And(hx, dbx.NewExp("created >= {:t}", dbx.Params{"t": weekAgo}))),
		"staleTotal":      staleTotal,
		"stale":           stale,
	})
}
