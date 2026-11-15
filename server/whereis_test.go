package main

import (
	"errors"

	"github.com/pocketbase/dbx"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// fixture holds the records every scenario starts from: two households,
// Ann and Ben in the first, Cat in the second, and Dan in none.
type fixture struct {
	app                *tests.TestApp
	h1, h2             *core.Record
	ann, ben, cat, dan *core.Record
	garage, shelf      *core.Record
	drill              *core.Record
}

func newFixture(t testing.TB) *fixture {
	t.Helper()
	app, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	Register(app, Config{AndroidPackage: "com.ssiuuk.whereis", AppDownloadURL: "https://example.com/app"})

	f := &fixture{app: app}
	f.h1 = f.save(t, "households", map[string]any{"name": "Home", "invite_code": "ABCD-2345"})
	f.h2 = f.save(t, "households", map[string]any{"name": "Other", "invite_code": "WXYZ-6789"})
	f.ann = f.user(t, "ann@example.com", f.h1.Id)
	f.ben = f.user(t, "ben@example.com", f.h1.Id)
	f.cat = f.user(t, "cat@example.com", f.h2.Id)
	f.dan = f.user(t, "dan@example.com", "")
	f.garage = f.save(t, "places", map[string]any{"household": f.h1.Id, "name": "Garage"})
	f.shelf = f.save(t, "places", map[string]any{"household": f.h1.Id, "name": "Shelf 3", "parent": f.garage.Id})
	f.drill = f.save(t, "items", map[string]any{"household": f.h1.Id, "name": "Drill", "place": f.garage.Id})
	return f
}

func (f *fixture) save(t testing.TB, collection string, data map[string]any) *core.Record {
	t.Helper()
	col, err := f.app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(col)
	r.Load(data)
	if err := f.app.Save(r); err != nil {
		t.Fatalf("saving %s: %v", collection, err)
	}
	return r
}

func (f *fixture) user(t testing.TB, email, household string) *core.Record {
	t.Helper()
	col, _ := f.app.FindCollectionByNameOrId("users")
	u := core.NewRecord(col)
	u.SetEmail(email)
	u.SetPassword("password123")
	u.Set("household", household)
	if err := f.app.Save(u); err != nil {
		t.Fatal(err)
	}
	return u
}

func token(t testing.TB, u *core.Record) string {
	t.Helper()
	tok, err := u.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func run(t *testing.T, f *fixture, s tests.ApiScenario) {
	t.Helper()
	s.TestAppFactory = func(testing.TB) *tests.TestApp { return f.app }
	s.DisableTestAppCleanup = true
	if len(s.ExpectedContent) == 0 && len(s.NotExpectedContent) == 0 && s.ExpectedStatus != 204 {
		s.ExpectedContent = []string{"{"}
	}
	s.Test(t)
}

func TestHouseholdIsolation(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()

	run(t, f, tests.ApiScenario{
		Name: "member lists own items", Method: http.MethodGet,
		URL:             "/api/collections/items/records",
		Headers:         map[string]string{"Authorization": token(t, f.ben)},
		ExpectedStatus:  200,
		ExpectedContent: []string{`"totalItems":1`, `"name":"Drill"`},
	})
	run(t, f, tests.ApiScenario{
		Name: "other household sees nothing", Method: http.MethodGet,
		URL:             "/api/collections/items/records",
		Headers:         map[string]string{"Authorization": token(t, f.cat)},
		ExpectedStatus:  200,
		ExpectedContent: []string{`"totalItems":0`},
	})
	run(t, f, tests.ApiScenario{
		Name: "user without household sees nothing", Method: http.MethodGet,
		URL:             "/api/collections/places/records",
		Headers:         map[string]string{"Authorization": token(t, f.dan)},
		ExpectedStatus:  200,
		ExpectedContent: []string{`"totalItems":0`},
	})
	run(t, f, tests.ApiScenario{
		Name: "anonymous is refused", Method: http.MethodGet,
		URL:             "/api/collections/items/records",
		ExpectedStatus:  200,
		ExpectedContent: []string{`"totalItems":0`},
	})
	run(t, f, tests.ApiScenario{
		Name: "can't create in another household", Method: http.MethodPost,
		URL:            "/api/collections/items/records",
		Headers:        map[string]string{"Authorization": token(t, f.cat)},
		Body:           strings.NewReader(`{"household":"` + f.h1.Id + `","name":"Sneaky"}`),
		ExpectedStatus: 400,
	})
	run(t, f, tests.ApiScenario{
		Name: "can't point an item at another household's place", Method: http.MethodPost,
		URL:             "/api/collections/items/records",
		Headers:         map[string]string{"Authorization": token(t, f.cat)},
		Body:            strings.NewReader(`{"household":"` + f.h2.Id + `","name":"Hammer","place":"` + f.garage.Id + `"}`),
		ExpectedStatus:  400,
		ExpectedContent: []string{"doesn't exist in your household"},
	})
	run(t, f, tests.ApiScenario{
		Name: "users can't set their own household", Method: http.MethodPatch,
		URL:            "/api/collections/users/records/" + f.dan.Id,
		Headers:        map[string]string{"Authorization": token(t, f.dan)},
		Body:           strings.NewReader(`{"household":"` + f.h1.Id + `"}`),
		ExpectedStatus: 404,
	})
	run(t, f, tests.ApiScenario{
		Name: "members see each other", Method: http.MethodGet,
		URL:             "/api/collections/users/records",
		Headers:         map[string]string{"Authorization": token(t, f.ann)},
		ExpectedStatus:  200,
		ExpectedContent: []string{`"totalItems":2`},
	})
}

func TestMoveIsRecorded(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()

	run(t, f, tests.ApiScenario{
		Name: "move drill to shelf", Method: http.MethodPatch,
		URL:             "/api/collections/items/records/" + f.drill.Id,
		Headers:         map[string]string{"Authorization": token(t, f.ben)},
		Body:            strings.NewReader(`{"place":"` + f.shelf.Id + `"}`),
		ExpectedStatus:  200,
		ExpectedContent: []string{`"place":"` + f.shelf.Id + `"`, `"moved_by":"` + f.ben.Id + `"`},
	})

	moves, err := f.app.FindRecordsByFilter("moves", "item = {:item}", "created", 0, 0, map[string]any{"item": f.drill.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(moves) != 1 {
		t.Fatalf("want 1 move, got %d", len(moves))
	}
	last := moves[0]
	if last.GetString("from_place") != f.garage.Id || last.GetString("to_place") != f.shelf.Id || last.GetString("by") != f.ben.Id {
		t.Fatalf("unexpected move %v", last.PublicExport())
	}

	run(t, f, tests.ApiScenario{
		Name: "renaming doesn't add a move", Method: http.MethodPatch,
		URL:            "/api/collections/items/records/" + f.drill.Id,
		Headers:        map[string]string{"Authorization": token(t, f.ben)},
		Body:           strings.NewReader(`{"name":"Cordless drill"}`),
		ExpectedStatus: 200,
	})
	n, _ := f.app.CountRecords("moves")
	if n != 1 {
		t.Fatalf("want 1 move after rename, got %d", n)
	}

	run(t, f, tests.ApiScenario{
		Name: "members read history", Method: http.MethodGet,
		URL:             "/api/collections/moves/records?filter=item='" + f.drill.Id + "'",
		Headers:         map[string]string{"Authorization": token(t, f.ann)},
		ExpectedStatus:  200,
		ExpectedContent: []string{`"totalItems":1`},
	})
	run(t, f, tests.ApiScenario{
		Name: "nobody writes history directly", Method: http.MethodPost,
		URL:            "/api/collections/moves/records",
		Headers:        map[string]string{"Authorization": token(t, f.ann)},
		Body:           strings.NewReader(`{"household":"` + f.h1.Id + `","item":"` + f.drill.Id + `"}`),
		ExpectedStatus: 403,
	})
}

func TestCreateWithPlaceRecordsMove(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()

	run(t, f, tests.ApiScenario{
		Name: "add item on the shelf", Method: http.MethodPost,
		URL:             "/api/collections/items/records",
		Headers:         map[string]string{"Authorization": token(t, f.ann)},
		Body:            strings.NewReader(`{"household":"` + f.h1.Id + `","name":"Tape","place":"` + f.shelf.Id + `"}`),
		ExpectedStatus:  200,
		ExpectedContent: []string{`"moved_by":"` + f.ann.Id + `"`},
	})
	n, _ := f.app.CountRecords("moves")
	if n != 1 {
		t.Fatalf("want 1 move, got %d", n)
	}
}

func TestPlaceRules(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()

	run(t, f, tests.ApiScenario{
		Name: "no loops", Method: http.MethodPatch,
		URL:             "/api/collections/places/records/" + f.garage.Id,
		Headers:         map[string]string{"Authorization": token(t, f.ann)},
		Body:            strings.NewReader(`{"parent":"` + f.shelf.Id + `"}`),
		ExpectedStatus:  400,
		ExpectedContent: []string{"inside one of the places inside it"},
	})
	run(t, f, tests.ApiScenario{
		Name: "can't delete a place with places inside", Method: http.MethodDelete,
		URL:             "/api/collections/places/records/" + f.garage.Id,
		Headers:         map[string]string{"Authorization": token(t, f.ann)},
		ExpectedStatus:  400,
		ExpectedContent: []string{"place(s) inside it"},
	})
	run(t, f, tests.ApiScenario{
		Name: "empty place can be deleted", Method: http.MethodDelete,
		URL:            "/api/collections/places/records/" + f.shelf.Id,
		Headers:        map[string]string{"Authorization": token(t, f.ann)},
		ExpectedStatus: 204,
	})
	run(t, f, tests.ApiScenario{
		Name: "can't delete a place holding items", Method: http.MethodDelete,
		URL:             "/api/collections/places/records/" + f.garage.Id,
		Headers:         map[string]string{"Authorization": token(t, f.ann)},
		ExpectedStatus:  400,
		ExpectedContent: []string{"item(s) in it"},
	})
}

func TestHouseholdRoutes(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()

	run(t, f, tests.ApiScenario{
		Name: "join needs sign-in", Method: http.MethodPost,
		URL:            "/api/whereis/join",
		Body:           strings.NewReader(`{"code":"ABCD-2345"}`),
		ExpectedStatus: 401,
	})
	run(t, f, tests.ApiScenario{
		Name: "wrong code", Method: http.MethodPost,
		URL:             "/api/whereis/join",
		Headers:         map[string]string{"Authorization": token(t, f.dan)},
		Body:            strings.NewReader(`{"code":"QQQQ-QQQQ"}`),
		ExpectedStatus:  404,
		ExpectedContent: []string{"No household has that invite code"},
	})
	run(t, f, tests.ApiScenario{
		Name: "join with a sloppily typed code", Method: http.MethodPost,
		URL:             "/api/whereis/join",
		Headers:         map[string]string{"Authorization": token(t, f.dan)},
		Body:            strings.NewReader(`{"code":" abcd2345 "}`),
		ExpectedStatus:  200,
		ExpectedContent: []string{`"id":"` + f.h1.Id + `"`},
	})
	dan, _ := f.app.FindRecordById("users", f.dan.Id)
	if dan.GetString("household") != f.h1.Id {
		t.Fatal("dan did not join")
	}

	run(t, f, tests.ApiScenario{
		Name: "can't create a second household", Method: http.MethodPost,
		URL:            "/api/whereis/households",
		Headers:        map[string]string{"Authorization": token(t, dan)},
		Body:           strings.NewReader(`{"name":"Mine"}`),
		ExpectedStatus: 400,
	})
	run(t, f, tests.ApiScenario{
		Name: "leave", Method: http.MethodPost,
		URL:            "/api/whereis/leave",
		Headers:        map[string]string{"Authorization": token(t, dan)},
		ExpectedStatus: 204,
	})
	run(t, f, tests.ApiScenario{
		Name: "create household", Method: http.MethodPost,
		URL:             "/api/whereis/households",
		Headers:         map[string]string{"Authorization": token(t, dan)},
		Body:            strings.NewReader(`{"name":"Dan's flat"}`),
		ExpectedStatus:  200,
		ExpectedContent: []string{`"name":"Dan's flat"`, `"invite_code":"`},
	})
	run(t, f, tests.ApiScenario{
		Name: "new invite code", Method: http.MethodPost,
		URL:                "/api/whereis/invite-code",
		Headers:            map[string]string{"Authorization": token(t, f.ann)},
		ExpectedStatus:     200,
		NotExpectedContent: []string{"ABCD-2345"},
	})
	run(t, f, tests.ApiScenario{
		Name: "members can't change the code by hand", Method: http.MethodPatch,
		URL:            "/api/collections/households/records/" + f.h1.Id,
		Headers:        map[string]string{"Authorization": token(t, f.ann)},
		Body:           strings.NewReader(`{"invite_code":"AAAA-AAAA"}`),
		ExpectedStatus: 404,
	})
	run(t, f, tests.ApiScenario{
		Name: "other households can't read the code", Method: http.MethodGet,
		URL:            "/api/collections/households/records/" + f.h1.Id,
		Headers:        map[string]string{"Authorization": token(t, f.cat)},
		ExpectedStatus: 404,
	})
}

func TestLandingPage(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()

	run(t, f, tests.ApiScenario{
		Name: "place label", Method: http.MethodGet,
		URL:            "/p/" + f.garage.Id,
		ExpectedStatus: 200,
		ExpectedContent: []string{
			"intent://p/" + f.garage.Id + "#Intent;scheme=whereis;package=com.ssiuuk.whereis;S.browser_fallback_url=https%3a%2f%2fexample.com%2fapp;end",
		},
		NotExpectedContent: []string{"Garage"},
	})
	run(t, f, tests.ApiScenario{
		Name: "junk id", Method: http.MethodGet,
		URL:            "/p/<script>",
		ExpectedStatus: 404,
	})
	run(t, f, tests.ApiScenario{
		Name: "asset links empty until configured", Method: http.MethodGet,
		URL:             "/.well-known/assetlinks.json",
		ExpectedStatus:  200,
		ExpectedContent: []string{"[]"},
	})
}

func TestWebApp(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<title>Where Is web</title>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "_expo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "_expo", "app.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}

	app, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	Register(app, Config{WebDir: dir, AndroidPackage: "com.ssiuuk.whereis"})
	f := &fixture{app: app}

	for _, url := range []string{"/", "/p/abcdefghij12345", "/i/abcdefghij12345", "/places", "/settings"} {
		run(t, f, tests.ApiScenario{
			Name: "web app at " + url, Method: http.MethodGet, URL: url,
			ExpectedStatus:  200,
			ExpectedContent: []string{"Where Is web"},
		})
	}
	run(t, f, tests.ApiScenario{
		Name: "web app files", Method: http.MethodGet, URL: "/_expo/app.js",
		ExpectedStatus:  200,
		ExpectedContent: []string{"console.log(1)"},
	})
	run(t, f, tests.ApiScenario{
		Name: "API still answers", Method: http.MethodGet, URL: "/api/health",
		ExpectedStatus:  200,
		ExpectedContent: []string{"API is healthy"},
	})
}

func TestInviteCodes(t *testing.T) {
	for i := 0; i < 200; i++ {
		c := newInviteCode()
		if normalizeInviteCode(c) != c {
			t.Fatalf("code %q doesn't round-trip", c)
		}
	}
	if got := normalizeInviteCode("abcd 2345"); got != "ABCD-2345" {
		t.Fatalf("got %q", got)
	}
	if normalizeInviteCode("ABC") != "" {
		t.Fatal("short code accepted")
	}
}

func TestConfigFromEnv(t *testing.T) {
	env := map[string]string{"ANDROID_CERT_SHA256": " aa:bb , cc:dd ,"}
	c := ConfigFromEnv(func(k string) string { return env[k] })
	if len(c.AndroidCertSHA256) != 2 || c.AndroidCertSHA256[0] != "AA:BB" {
		t.Fatalf("got %v", c.AndroidCertSHA256)
	}
	if c.AndroidPackage != "com.ssiuuk.whereis" || c.AppDownloadURL == "" {
		t.Fatalf("defaults missing: %+v", c)
	}
}

func TestGoogleSignInFromEnv(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()

	if err := applyGoogleConfig(f.app, Config{GoogleClientID: "id-1", GoogleClientSecret: "secret"}); err != nil {
		t.Fatal(err)
	}
	// applying twice updates instead of adding a second provider
	if err := applyGoogleConfig(f.app, Config{GoogleClientID: "id-2", GoogleClientSecret: "secret"}); err != nil {
		t.Fatal(err)
	}
	run(t, f, tests.ApiScenario{
		Name: "auth methods offer Google", Method: http.MethodGet,
		URL:             "/api/collections/users/auth-methods",
		ExpectedStatus:  200,
		ExpectedContent: []string{`"name":"google"`, `client_id=id-2`},
	})
	users, _ := f.app.FindCollectionByNameOrId("users")
	if len(users.OAuth2.Providers) != 1 {
		t.Fatalf("want 1 provider, got %d", len(users.OAuth2.Providers))
	}
}

func countMoves(t *testing.T, f *fixture, item string) int {
	t.Helper()
	n, err := f.app.CountRecords("moves", dbx.HashExp{"item": item})
	if err != nil {
		t.Fatal(err)
	}
	return int(n)
}

func TestMoveStampIsServerOnly(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()

	run(t, f, tests.ApiScenario{
		Name: "can't forge who moved an item", Method: http.MethodPatch,
		URL:            "/api/collections/items/records/" + f.drill.Id,
		Headers:        map[string]string{"Authorization": token(t, f.ann)},
		Body:           strings.NewReader(`{"place":"` + f.shelf.Id + `","moved_by":"` + f.ben.Id + `"}`),
		ExpectedStatus: 404,
	})
	run(t, f, tests.ApiScenario{
		Name: "can't backdate a move", Method: http.MethodPatch,
		URL:            "/api/collections/items/records/" + f.drill.Id,
		Headers:        map[string]string{"Authorization": token(t, f.ann)},
		Body:           strings.NewReader(`{"name":"Drill","moved_at":"2020-01-01 00:00:00.000Z"}`),
		ExpectedStatus: 404,
	})
	run(t, f, tests.ApiScenario{
		Name: "can't create an item with a forged mover", Method: http.MethodPost,
		URL:            "/api/collections/items/records",
		Headers:        map[string]string{"Authorization": token(t, f.ann)},
		Body:           strings.NewReader(`{"household":"` + f.h1.Id + `","name":"Saw","moved_by":"` + f.ben.Id + `"}`),
		ExpectedStatus: 400,
	})
	d, _ := f.app.FindRecordById("items", f.drill.Id)
	if d.GetString("place") != f.garage.Id || d.GetString("moved_by") != "" || countMoves(t, f, f.drill.Id) != 0 {
		t.Fatalf("rejected requests changed the drill: place=%s moved_by=%s", d.GetString("place"), d.GetString("moved_by"))
	}
}

func TestMoveFailsWhenHistoryFails(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()
	f.app.OnRecordCreate("moves").BindFunc(func(e *core.RecordEvent) error {
		return errors.New("disk full")
	})
	run(t, f, tests.ApiScenario{
		Name: "move is refused", Method: http.MethodPatch,
		URL:            "/api/collections/items/records/" + f.drill.Id,
		Headers:        map[string]string{"Authorization": token(t, f.ann)},
		Body:           strings.NewReader(`{"place":"` + f.shelf.Id + `"}`),
		ExpectedStatus: 400,
	})
	d, _ := f.app.FindRecordById("items", f.drill.Id)
	if d.GetString("place") != f.garage.Id {
		t.Fatal("the item moved although its history wasn't saved")
	}
}

func TestBulkMove(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()
	saw := f.save(t, "items", map[string]any{"household": f.h1.Id, "name": "Saw"})
	theirs := f.save(t, "items", map[string]any{"household": f.h2.Id, "name": "Their hammer"})

	run(t, f, tests.ApiScenario{
		Name: "one foreign item moves nothing", Method: http.MethodPost,
		URL:             "/api/whereis/move",
		Headers:         map[string]string{"Authorization": token(t, f.ann)},
		Body:            strings.NewReader(`{"items":["` + f.drill.Id + `","` + theirs.Id + `"],"place":"` + f.shelf.Id + `"}`),
		ExpectedStatus:  404,
		ExpectedContent: []string{"Nothing was moved"},
	})
	if d, _ := f.app.FindRecordById("items", f.drill.Id); d.GetString("place") != f.garage.Id || countMoves(t, f, f.drill.Id) != 0 {
		t.Fatal("a failed bulk move changed the drill")
	}
	run(t, f, tests.ApiScenario{
		Name: "place in another household", Method: http.MethodPost,
		URL:            "/api/whereis/move",
		Headers:        map[string]string{"Authorization": token(t, f.cat)},
		Body:           strings.NewReader(`{"items":["` + theirs.Id + `"],"place":"` + f.shelf.Id + `"}`),
		ExpectedStatus: 400,
	})
	run(t, f, tests.ApiScenario{
		Name: "all move together", Method: http.MethodPost,
		URL:             "/api/whereis/move",
		Headers:         map[string]string{"Authorization": token(t, f.ben)},
		Body:            strings.NewReader(`{"items":["` + f.drill.Id + `","` + saw.Id + `"],"place":"` + f.shelf.Id + `"}`),
		ExpectedStatus:  200,
		ExpectedContent: []string{`"name":"Drill"`, `"name":"Saw"`, `"moved_by":"` + f.ben.Id + `"`},
	})
	for _, id := range []string{f.drill.Id, saw.Id} {
		r, _ := f.app.FindRecordById("items", id)
		if r.GetString("place") != f.shelf.Id || countMoves(t, f, id) != 1 {
			t.Fatalf("%s not moved with history", r.GetString("name"))
		}
	}
	m, _ := f.app.FindFirstRecordByData("moves", "item", saw.Id)
	if m.GetString("to_name") != "Garage › Shelf 3" {
		t.Fatalf("to_name = %q", m.GetString("to_name"))
	}
	run(t, f, tests.ApiScenario{
		Name: "no household", Method: http.MethodPost,
		URL:            "/api/whereis/move",
		Headers:        map[string]string{"Authorization": token(t, f.dan)},
		Body:           strings.NewReader(`{"items":["` + saw.Id + `"],"place":""}`),
		ExpectedStatus: 400,
	})
}

func TestMembersCantSwitchHouseholdsByJoining(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()
	run(t, f, tests.ApiScenario{
		Name: "member of h2 joins h1", Method: http.MethodPost,
		URL:             "/api/whereis/join",
		Headers:         map[string]string{"Authorization": token(t, f.cat)},
		Body:            strings.NewReader(`{"code":"ABCD-2345"}`),
		ExpectedStatus:  400,
		ExpectedContent: []string{"Leave it in Settings"},
	})
	run(t, f, tests.ApiScenario{
		Name: "rejoining own household is fine", Method: http.MethodPost,
		URL:            "/api/whereis/join",
		Headers:        map[string]string{"Authorization": token(t, f.ann)},
		Body:           strings.NewReader(`{"code":"ABCD-2345"}`),
		ExpectedStatus: 200,
	})
	run(t, f, tests.ApiScenario{
		Name: "member can't create a second household", Method: http.MethodPost,
		URL:            "/api/whereis/households",
		Headers:        map[string]string{"Authorization": token(t, f.cat)},
		Body:           strings.NewReader(`{"name":"Second"}`),
		ExpectedStatus: 400,
	})
	if c, _ := f.app.FindRecordById("users", f.cat.Id); c.GetString("household") != f.h2.Id {
		t.Fatal("cat switched households")
	}
}
