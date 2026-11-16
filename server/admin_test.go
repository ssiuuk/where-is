package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// adminFixture: Ann owns household 1 (family admin), Ben is a member, and
// Dan (no household) is the site admin through ADMIN_EMAILS.
func adminFixture(t *testing.T) *fixture {
	t.Helper()
	f := newFixtureWith(t, Config{AdminEmails: []string{"dan@example.com", "eve@example.com"}})
	f.h1.Set("owner", f.ann.Id)
	if err := f.app.Save(f.h1); err != nil {
		t.Fatal(err)
	}
	f.dan.SetVerified(true)
	if err := f.app.Save(f.dan); err != nil {
		t.Fatal(err)
	}
	return f
}

func asUser(t testing.TB, u *core.Record) map[string]string {
	return map[string]string{"Authorization": token(t, u)}
}

func decode(t testing.TB, res *http.Response, out any) {
	t.Helper()
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		t.Fatal(err)
	}
}

func TestAdminRoles(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()

	run(t, f, tests.ApiScenario{
		Name: "family admin", Method: http.MethodGet, URL: "/api/whereis/admin/roles",
		Headers: asUser(t, f.ann), ExpectedStatus: 200,
		ExpectedContent: []string{`"family":true`, `"site":false`},
	})
	run(t, f, tests.ApiScenario{
		Name: "plain member", Method: http.MethodGet, URL: "/api/whereis/admin/roles",
		Headers: asUser(t, f.ben), ExpectedStatus: 200,
		ExpectedContent: []string{`"family":false`, `"site":false`},
	})
	run(t, f, tests.ApiScenario{
		Name: "site admin", Method: http.MethodGet, URL: "/api/whereis/admin/roles",
		Headers: asUser(t, f.dan), ExpectedStatus: 200,
		ExpectedContent: []string{`"site":true`},
	})
	// an unverified account with a listed email is not an admin
	eve := f.user(t, "Eve@Example.com", "")
	run(t, f, tests.ApiScenario{
		Name: "unverified listed email", Method: http.MethodGet, URL: "/api/whereis/admin/roles",
		Headers: asUser(t, eve), ExpectedStatus: 200,
		ExpectedContent: []string{`"site":false`, `"siteNeedsVerify":true`},
	})
	run(t, f, tests.ApiScenario{
		Name: "unverified listed email can't use site tools", Method: http.MethodGet, URL: "/api/whereis/admin/site/users",
		Headers: asUser(t, eve), ExpectedStatus: 403,
	})
	run(t, f, tests.ApiScenario{
		Name: "member can't use family tools", Method: http.MethodGet, URL: "/api/whereis/admin/family",
		Headers: asUser(t, f.ben), ExpectedStatus: 403,
	})
	run(t, f, tests.ApiScenario{
		Name: "family admin can't use site tools", Method: http.MethodGet, URL: "/api/whereis/admin/site",
		Headers: asUser(t, f.ann), ExpectedStatus: 403,
	})
	run(t, f, tests.ApiScenario{
		Name: "signed out", Method: http.MethodGet, URL: "/api/whereis/admin/family",
		ExpectedStatus: 401,
	})
	run(t, f, tests.ApiScenario{
		Name: "family overview", Method: http.MethodGet, URL: "/api/whereis/admin/family",
		Headers: asUser(t, f.ann), ExpectedStatus: 200,
		ExpectedContent:    []string{`"invite_code":"ABCD-2345"`, `"email":"ben@example.com"`, `"owner":true`},
		NotExpectedContent: []string{"cat@example.com"},
	})
}

func TestFamilyInvitesAndMembers(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()

	run(t, f, tests.ApiScenario{
		Name: "turn invites off", Method: http.MethodPost, URL: "/api/whereis/admin/family/invite",
		Headers: asUser(t, f.ann), Body: strings.NewReader(`{"action":"off"}`),
		ExpectedStatus: 200, ExpectedContent: []string{`"invites_off":true`},
	})
	eve := f.user(t, "eve2@example.com", "")
	run(t, f, tests.ApiScenario{
		Name: "can't join while off", Method: http.MethodPost, URL: "/api/whereis/join",
		Headers: asUser(t, eve), Body: strings.NewReader(`{"code":"ABCD-2345"}`),
		ExpectedStatus: 403, ExpectedContent: []string{"isn't taking new members"},
	})
	run(t, f, tests.ApiScenario{
		Name: "members can't turn invites back on themselves", Method: http.MethodPatch,
		URL: "/api/collections/households/records/" + f.h1.Id, Headers: asUser(t, f.ben),
		Body: strings.NewReader(`{"invites_off":false}`), ExpectedStatus: 404,
	})
	run(t, f, tests.ApiScenario{
		Name: "new code turns invites on", Method: http.MethodPost, URL: "/api/whereis/admin/family/invite",
		Headers: asUser(t, f.ann), Body: strings.NewReader(`{"action":"new"}`),
		ExpectedStatus: 200, ExpectedContent: []string{`"invites_off":false`}, NotExpectedContent: []string{"ABCD-2345"},
	})
	run(t, f, tests.ApiScenario{
		Name: "remove a member", Method: http.MethodPost, URL: "/api/whereis/admin/family/members/" + f.ben.Id + "/remove",
		Headers: asUser(t, f.ann), ExpectedStatus: 200, NotExpectedContent: []string{"ben@example.com"},
	})
	run(t, f, tests.ApiScenario{
		Name: "can't remove someone from another household", Method: http.MethodPost,
		URL: "/api/whereis/admin/family/members/" + f.cat.Id + "/remove", Headers: asUser(t, f.ann), ExpectedStatus: 404,
	})

	// leaving hands family admin to the next member
	ben := f.user(t, "ben2@example.com", f.h1.Id)
	run(t, f, tests.ApiScenario{
		Name: "owner leaves", Method: http.MethodPost, URL: "/api/whereis/leave",
		Headers: asUser(t, f.ann), ExpectedStatus: 204,
	})
	h, _ := f.app.FindRecordById("households", f.h1.Id)
	if h.GetString("owner") != ben.Id {
		t.Fatalf("owner is %q, want the remaining member", h.GetString("owner"))
	}
}

func TestHandOverFamilyAdmin(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	run(t, f, tests.ApiScenario{
		Name: "hand over", Method: http.MethodPost, URL: "/api/whereis/admin/family/owner",
		Headers: asUser(t, f.ann), Body: strings.NewReader(`{"user":"` + f.ben.Id + `"}`), ExpectedStatus: 204,
	})
	run(t, f, tests.ApiScenario{
		Name: "old owner is no longer family admin", Method: http.MethodGet, URL: "/api/whereis/admin/family",
		Headers: asUser(t, f.ann), ExpectedStatus: 403,
	})
	run(t, f, tests.ApiScenario{
		Name: "new owner is", Method: http.MethodGet, URL: "/api/whereis/admin/family",
		Headers: asUser(t, f.ben), ExpectedStatus: 200,
	})
}

func TestRecycleBin(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()

	// give the drill some history, then delete it as a member
	run(t, f, tests.ApiScenario{
		Name: "move", Method: http.MethodPatch, URL: "/api/collections/items/records/" + f.drill.Id,
		Headers: asUser(t, f.ben), Body: strings.NewReader(`{"place":"` + f.shelf.Id + `"}`), ExpectedStatus: 200,
	})
	run(t, f, tests.ApiScenario{
		Name: "delete", Method: http.MethodDelete, URL: "/api/collections/items/records/" + f.drill.Id,
		Headers: asUser(t, f.ben), ExpectedStatus: 204,
	})
	var trashID string
	run(t, f, tests.ApiScenario{
		Name: "in the bin", Method: http.MethodGet, URL: "/api/whereis/admin/family/trash",
		Headers: asUser(t, f.ann), ExpectedStatus: 200,
		ExpectedContent: []string{`"name":"Drill"`, `"place":"Garage › Shelf 3"`},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			var out struct{ Items []struct{ ID string } }
			decode(t, res, &out)
			trashID = out.Items[0].ID
		},
	})
	run(t, f, tests.ApiScenario{
		Name: "other family admins can't see it", Method: http.MethodPost, URL: "/api/whereis/admin/family/trash/" + trashID + "/restore",
		Headers: asUser(t, f.cat), ExpectedStatus: 403,
	})
	run(t, f, tests.ApiScenario{
		Name: "restore", Method: http.MethodPost, URL: "/api/whereis/admin/family/trash/" + trashID + "/restore",
		Headers: asUser(t, f.ann), ExpectedStatus: 204,
	})
	item, err := f.app.FindRecordById("items", f.drill.Id)
	if err != nil {
		t.Fatal("drill not restored with its old id")
	}
	if item.GetString("place") != f.shelf.Id {
		t.Fatalf("restored to %q", item.GetString("place"))
	}
	if n := countMoves(t, f, f.drill.Id); n != 1 {
		t.Fatalf("history has %d moves after restore, want 1", n)
	}

	// a deleted place comes back too; its parent is cleared if gone
	run(t, f, tests.ApiScenario{
		Name: "move drill away", Method: http.MethodPatch, URL: "/api/collections/items/records/" + f.drill.Id,
		Headers: asUser(t, f.ben), Body: strings.NewReader(`{"place":""}`), ExpectedStatus: 200,
	})
	run(t, f, tests.ApiScenario{
		Name: "delete place", Method: http.MethodDelete, URL: "/api/collections/places/records/" + f.shelf.Id,
		Headers: asUser(t, f.ben), ExpectedStatus: 204,
	})
	trash, _ := f.app.FindFirstRecordByData("trash", "record", f.shelf.Id)
	run(t, f, tests.ApiScenario{
		Name: "restore place", Method: http.MethodPost, URL: "/api/whereis/admin/family/trash/" + trash.Id + "/restore",
		Headers: asUser(t, f.ann), ExpectedStatus: 204,
	})
	if p, err := f.app.FindRecordById("places", f.shelf.Id); err != nil || p.GetString("parent") != f.garage.Id {
		t.Fatalf("place not restored: %v", err)
	}
}

func TestActivityLog(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	run(t, f, tests.ApiScenario{
		Name: "add", Method: http.MethodPost, URL: "/api/collections/items/records",
		Headers: asUser(t, f.ben), Body: strings.NewReader(`{"household":"` + f.h1.Id + `","name":"Saw","place":"` + f.garage.Id + `"}`),
		ExpectedStatus: 200,
	})
	run(t, f, tests.ApiScenario{
		Name: "rename and move", Method: http.MethodPatch, URL: "/api/collections/items/records/" + f.drill.Id,
		Headers: asUser(t, f.ben), Body: strings.NewReader(`{"name":"Big drill","place":"` + f.shelf.Id + `"}`), ExpectedStatus: 200,
	})
	run(t, f, tests.ApiScenario{
		Name: "label printed: not logged", Method: http.MethodPatch, URL: "/api/collections/places/records/" + f.garage.Id,
		Headers: asUser(t, f.ben), Body: strings.NewReader(`{"label_at":"2026-11-16 10:00:00.000Z"}`), ExpectedStatus: 200,
	})
	run(t, f, tests.ApiScenario{
		Name: "log", Method: http.MethodGet, URL: "/api/whereis/admin/family/activity",
		Headers: asUser(t, f.ann), ExpectedStatus: 200,
		ExpectedContent: []string{`"action":"added"`, `"name":"Saw"`, `"action":"moved"`, `"detail":"Garage → Garage › Shelf 3"`,
			`"action":"renamed"`, `"detail":"was Drill"`, `"by":"ben@example.com"`},
		NotExpectedContent: []string{`"kind":"place"`},
	})
}

func TestImportExport(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	csv := "Name,Place,Note\nHammer,Garage > Shelf 3,claw\nTent,Loft > Box 2,\nDrill,Garage,\n,,\n"
	body := func(dry bool) *strings.Reader {
		b, _ := json.Marshal(map[string]any{"kind": "items", "csv": csv, "dryRun": dry})
		return strings.NewReader(string(b))
	}
	run(t, f, tests.ApiScenario{
		Name: "dry run", Method: http.MethodPost, URL: "/api/whereis/admin/family/import",
		Headers: asUser(t, f.ann), Body: body(true), ExpectedStatus: 200,
		ExpectedContent: []string{`"items":2`, `"places":2`, `"skipped":2`},
	})
	if n, _ := f.app.CountRecords("items", dbx.HashExp{"household": f.h1.Id}); n != 1 {
		t.Fatalf("dry run saved items: %d", n)
	}
	run(t, f, tests.ApiScenario{
		Name: "import", Method: http.MethodPost, URL: "/api/whereis/admin/family/import",
		Headers: asUser(t, f.ann), Body: body(false), ExpectedStatus: 200,
		ExpectedContent: []string{`"items":2`, `"places":2`},
	})
	run(t, f, tests.ApiScenario{
		Name: "import again skips everything", Method: http.MethodPost, URL: "/api/whereis/admin/family/import",
		Headers: asUser(t, f.ann), Body: body(false), ExpectedStatus: 200,
		ExpectedContent: []string{`"items":0`, `"places":0`},
	})
	run(t, f, tests.ApiScenario{
		Name: "bad header", Method: http.MethodPost, URL: "/api/whereis/admin/family/import",
		Headers: asUser(t, f.ann), Body: strings.NewReader(`{"kind":"items","csv":"what,where\na,b"}`), ExpectedStatus: 400,
	})

	tok, _ := f.ann.NewFileToken()
	run(t, f, tests.ApiScenario{
		Name: "export with a file token", Method: http.MethodGet,
		URL:            "/api/whereis/admin/download/export/items.csv?token=" + tok,
		ExpectedStatus: 200, ExpectedContent: []string{"name,place,note,moved_at,id", "Hammer,Garage › Shelf 3,claw", "Tent,Loft › Box 2"},
	})
	benTok, _ := f.ben.NewFileToken()
	run(t, f, tests.ApiScenario{
		Name: "members can't export", Method: http.MethodGet,
		URL: "/api/whereis/admin/download/export/items.csv?token=" + benTok, ExpectedStatus: 403,
	})
	run(t, f, tests.ApiScenario{
		Name: "no token", Method: http.MethodGet, URL: "/api/whereis/admin/download/export/places.csv", ExpectedStatus: 401,
	})
}

func TestMergeDuplicates(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	garage2 := f.save(t, "places", map[string]any{"household": f.h1.Id, "name": "garage "})
	box := f.save(t, "places", map[string]any{"household": f.h1.Id, "name": "Box", "parent": garage2.Id})
	saw := f.save(t, "items", map[string]any{"household": f.h1.Id, "name": "Saw", "place": garage2.Id, "note": "rusty"})
	saw2 := f.save(t, "items", map[string]any{"household": f.h1.Id, "name": "saw", "place": f.garage.Id})

	run(t, f, tests.ApiScenario{
		Name: "find", Method: http.MethodGet, URL: "/api/whereis/admin/family/duplicates",
		Headers: asUser(t, f.ann), ExpectedStatus: 200,
		ExpectedContent: []string{`"id":"` + garage2.Id + `"`, `"id":"` + saw2.Id + `"`},
	})
	run(t, f, tests.ApiScenario{
		Name: "merge places", Method: http.MethodPost, URL: "/api/whereis/admin/family/merge",
		Headers: asUser(t, f.ann), Body: strings.NewReader(`{"kind":"places","keep":"` + f.garage.Id + `","merge":["` + garage2.Id + `"]}`),
		ExpectedStatus: 204,
	})
	if b, _ := f.app.FindRecordById("places", box.Id); b.GetString("parent") != f.garage.Id {
		t.Fatal("box didn't move into the kept place")
	}
	if s, _ := f.app.FindRecordById("items", saw.Id); s.GetString("place") != f.garage.Id {
		t.Fatal("saw didn't move into the kept place")
	}
	run(t, f, tests.ApiScenario{
		Name: "merge items", Method: http.MethodPost, URL: "/api/whereis/admin/family/merge",
		Headers: asUser(t, f.ann), Body: strings.NewReader(`{"kind":"items","keep":"` + saw2.Id + `","merge":["` + saw.Id + `"]}`),
		ExpectedStatus: 204,
	})
	if s, _ := f.app.FindRecordById("items", saw2.Id); s.GetString("note") != "rusty" {
		t.Fatalf("note not merged: %q", s.GetString("note"))
	}
	if n, _ := f.app.CountRecords("trash", dbx.HashExp{"household": f.h1.Id}); n != 2 {
		t.Fatalf("%d merged records in the bin, want 2", n)
	}
	run(t, f, tests.ApiScenario{
		Name: "can't merge across households", Method: http.MethodPost, URL: "/api/whereis/admin/family/merge",
		Headers: asUser(t, f.cat), Body: strings.NewReader(`{"kind":"items","keep":"` + saw2.Id + `","merge":["` + f.drill.Id + `"]}`),
		ExpectedStatus: 403,
	})
}

func TestFamilyStats(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	old := f.save(t, "items", map[string]any{"household": f.h1.Id, "name": "Old lamp"})
	if _, err := f.app.DB().Update("items", dbx.Params{"created": "2020-01-01 00:00:00.000Z"}, dbx.HashExp{"id": old.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	run(t, f, tests.ApiScenario{
		Name: "stats", Method: http.MethodGet, URL: "/api/whereis/admin/family/stats",
		Headers: asUser(t, f.ann), ExpectedStatus: 200,
		ExpectedContent: []string{`"items":2`, `"places":2`, `"members":2`, `"unlabeled":2`, `"staleTotal":1`, `"name":"Old lamp"`},
	})
}

func TestSiteSignupSwitch(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	signup := `{"email":"new@example.com","password":"password123","passwordConfirm":"password123"}`
	run(t, f, tests.ApiScenario{
		Name: "close sign-up", Method: http.MethodPut, URL: "/api/whereis/admin/site/signup",
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{"open":false}`), ExpectedStatus: 200,
	})
	run(t, f, tests.ApiScenario{
		Name: "config says closed", Method: http.MethodGet, URL: "/api/whereis/config",
		ExpectedStatus: 200, ExpectedContent: []string{`"signup":false`},
	})
	run(t, f, tests.ApiScenario{
		Name: "sign-up refused", Method: http.MethodPost, URL: "/api/collections/users/records",
		Body: strings.NewReader(signup), ExpectedStatus: 403,
	})
	run(t, f, tests.ApiScenario{
		Name: "open again", Method: http.MethodPut, URL: "/api/whereis/admin/site/signup",
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{"open":true}`), ExpectedStatus: 200,
	})
	run(t, f, tests.ApiScenario{
		Name: "sign-up works", Method: http.MethodPost, URL: "/api/collections/users/records",
		Body: strings.NewReader(signup), ExpectedStatus: 200,
	})

	// ALLOW_SIGNUP in .env locks the switch
	app, _ := tests.NewTestApp(t.TempDir())
	defer app.Cleanup()
	cfg := ConfigFromEnv(func(k string) string {
		return map[string]string{"ALLOW_SIGNUP": "true", "ADMIN_EMAILS": " Dan@Example.com "}[k]
	})
	if !cfg.SignupLocked || cfg.SignupClosed || len(cfg.AdminEmails) != 1 || cfg.AdminEmails[0] != "dan@example.com" {
		t.Fatalf("config: %+v", cfg)
	}
	Register(app, cfg)
	col, _ := app.FindCollectionByNameOrId("users")
	dan := core.NewRecord(col)
	dan.SetEmail("dan@example.com")
	dan.SetPassword("password123")
	dan.SetVerified(true)
	if err := app.Save(dan); err != nil {
		t.Fatal(err)
	}
	(&tests.ApiScenario{
		Name: "locked by env", Method: http.MethodPut, URL: "/api/whereis/admin/site/signup",
		Headers: asUser(t, dan), Body: strings.NewReader(`{"open":false}`), ExpectedStatus: 400,
		ExpectedContent:       []string{"ALLOW_SIGNUP"},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

func TestSiteAccounts(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	benToken := token(t, f.ben)

	run(t, f, tests.ApiScenario{
		Name: "list", Method: http.MethodGet, URL: "/api/whereis/admin/site/users",
		Headers: asUser(t, f.dan), ExpectedStatus: 200,
		ExpectedContent: []string{`"email":"cat@example.com"`, `"household":"Home"`, `"family_admin":true`, `"site_admin":true`},
	})
	run(t, f, tests.ApiScenario{
		Name: "can't turn off yourself", Method: http.MethodPatch, URL: "/api/whereis/admin/site/users/" + f.dan.Id,
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{"disabled":true}`), ExpectedStatus: 400,
	})
	run(t, f, tests.ApiScenario{
		Name: "turn off Ann", Method: http.MethodPatch, URL: "/api/whereis/admin/site/users/" + f.ann.Id,
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{"disabled":true}`), ExpectedStatus: 204,
	})
	h, _ := f.app.FindRecordById("households", f.h1.Id)
	if h.GetString("owner") != f.ben.Id {
		t.Fatal("household wasn't handed over when its admin was turned off")
	}
	run(t, f, tests.ApiScenario{
		Name: "Ann can't sign in", Method: http.MethodPost, URL: "/api/collections/users/auth-with-password",
		Body: strings.NewReader(`{"identity":"ann@example.com","password":"password123"}`), ExpectedStatus: 403,
	})

	var pw string
	run(t, f, tests.ApiScenario{
		Name: "new password for Ben", Method: http.MethodPost, URL: "/api/whereis/admin/site/users/" + f.ben.Id + "/password",
		Headers: asUser(t, f.dan), ExpectedStatus: 200,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			var out struct{ Password string }
			decode(t, res, &out)
			pw = out.Password
		},
	})
	run(t, f, tests.ApiScenario{
		Name: "old sign-in stopped working", Method: http.MethodGet, URL: "/api/whereis/admin/family",
		Headers: map[string]string{"Authorization": benToken}, ExpectedStatus: 401,
	})
	run(t, f, tests.ApiScenario{
		Name: "Ben signs in with it", Method: http.MethodPost, URL: "/api/collections/users/auth-with-password",
		Body: strings.NewReader(`{"identity":"ben@example.com","password":"` + pw + `"}`), ExpectedStatus: 200,
	})
	run(t, f, tests.ApiScenario{
		Name: "delete Cat", Method: http.MethodDelete, URL: "/api/whereis/admin/site/users/" + f.cat.Id,
		Headers: asUser(t, f.dan), ExpectedStatus: 204,
	})
	if _, err := f.app.FindRecordById("users", f.cat.Id); err == nil {
		t.Fatal("Cat still exists")
	}
}

func TestDisabledTokenStopsWorking(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	tok := token(t, f.ben)
	// turned off directly, without a new token key: the flag alone blocks it
	f.ben.Set("disabled", true)
	if err := f.app.Save(f.ben); err != nil {
		t.Fatal(err)
	}
	run(t, f, tests.ApiScenario{
		Name: "blocked", Method: http.MethodGet, URL: "/api/collections/items/records",
		Headers: map[string]string{"Authorization": tok}, ExpectedStatus: 401,
	})
}

func TestLastActive(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	run(t, f, tests.ApiScenario{
		Name: "sign in", Method: http.MethodPost, URL: "/api/collections/users/auth-with-password",
		Body: strings.NewReader(`{"identity":"ben@example.com","password":"password123"}`), ExpectedStatus: 200,
	})
	u, _ := f.app.FindRecordById("users", f.ben.Id)
	if u.GetString("last_active") == "" {
		t.Fatal("last_active not set")
	}
	run(t, f, tests.ApiScenario{
		Name: "users can't set it", Method: http.MethodPatch, URL: "/api/collections/users/records/" + f.ben.Id,
		Headers: asUser(t, f.ben), Body: strings.NewReader(`{"disabled":false}`), ExpectedStatus: 404,
	})
}

func TestSiteMail(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	run(t, f, tests.ApiScenario{
		Name: "needs a from address", Method: http.MethodPut, URL: "/api/whereis/admin/site/mail",
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{"enabled":true,"host":"smtp.example.com"}`), ExpectedStatus: 400,
	})
	run(t, f, tests.ApiScenario{
		Name: "save", Method: http.MethodPut, URL: "/api/whereis/admin/site/mail",
		Headers:        asUser(t, f.dan),
		Body:           strings.NewReader(`{"enabled":true,"host":"smtp.example.com","port":465,"tls":true,"username":"u","password":"secret","fromAddress":"whereis@example.com","fromName":"Home"}`),
		ExpectedStatus: 200, ExpectedContent: []string{`"host":"smtp.example.com"`, `"hasPassword":true`},
		NotExpectedContent: []string{"secret"},
	})
	run(t, f, tests.ApiScenario{
		Name: "test email", Method: http.MethodPost, URL: "/api/whereis/admin/site/mail/test",
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{}`), ExpectedStatus: 200,
		ExpectedContent: []string{`"to":"dan@example.com"`},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			if app.TestMailer.TotalSend() != 1 || !strings.Contains(app.TestMailer.LastMessage().Subject, "test") {
				t.Fatal("no test email sent")
			}
		},
	})

	locked := newFixtureWith(t, Config{AdminEmails: []string{"dan@example.com"}, Mail: MailConfig{Host: "smtp.env", FromAddress: "a@b.c", FromName: "Where Is", Port: 587}})
	defer locked.app.Cleanup()
	locked.dan.SetVerified(true)
	_ = locked.app.Save(locked.dan)
	run(t, locked, tests.ApiScenario{
		Name: "locked by env", Method: http.MethodPut, URL: "/api/whereis/admin/site/mail",
		Headers: asUser(t, locked.dan), Body: strings.NewReader(`{"enabled":false}`), ExpectedStatus: 400,
	})
}

func TestSiteGoogle(t *testing.T) {
	answer := `{"error":"invalid_grant"}`
	google := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("client_secret") != "right" {
			answer = `{"error":"invalid_client"}`
		}
		w.WriteHeader(400)
		_, _ = w.Write([]byte(answer))
	}))
	defer google.Close()
	googleTokenURL = google.URL
	defer func() { googleTokenURL = "https://oauth2.googleapis.com/token" }()

	f := adminFixture(t)
	defer f.app.Cleanup()
	s := f.app.Settings()
	s.Meta.AppURL = "https://whereis.example.com"
	_ = f.app.Save(s)

	run(t, f, tests.ApiScenario{
		Name: "turn on without keys", Method: http.MethodPut, URL: "/api/whereis/admin/site/google",
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{"enabled":true}`), ExpectedStatus: 400,
	})
	run(t, f, tests.ApiScenario{
		Name: "turn on", Method: http.MethodPut, URL: "/api/whereis/admin/site/google",
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{"enabled":true,"clientId":"id","clientSecret":"right"}`),
		ExpectedStatus: 200, ExpectedContent: []string{`"enabled":true`, `"redirectUrl":"https://whereis.example.com/api/oauth2-redirect"`},
		NotExpectedContent: []string{"right"},
	})
	run(t, f, tests.ApiScenario{
		Name: "check passes", Method: http.MethodPost, URL: "/api/whereis/admin/site/google/check",
		Headers: asUser(t, f.dan), ExpectedStatus: 200, ExpectedContent: []string{`"ok":true`},
	})
	run(t, f, tests.ApiScenario{
		Name: "wrong secret", Method: http.MethodPut, URL: "/api/whereis/admin/site/google",
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{"enabled":true,"clientSecret":"wrong"}`), ExpectedStatus: 200,
	})
	run(t, f, tests.ApiScenario{
		Name: "check fails", Method: http.MethodPost, URL: "/api/whereis/admin/site/google/check",
		Headers: asUser(t, f.dan), ExpectedStatus: 200, ExpectedContent: []string{`"ok":false`, "doesn't accept"},
	})
	run(t, f, tests.ApiScenario{
		Name: "turn off", Method: http.MethodPut, URL: "/api/whereis/admin/site/google",
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{"enabled":false}`), ExpectedStatus: 200,
		ExpectedContent: []string{`"enabled":false`},
	})
	// turned off stays off when the server restarts with keys in .env
	if err := applyGoogleConfig(f.app, Config{GoogleClientID: "id", GoogleClientSecret: "right"}); err != nil {
		t.Fatal(err)
	}
	users, _ := f.app.FindCollectionByNameOrId("users")
	if users.OAuth2.Enabled {
		t.Fatal("Google sign-in was turned back on at start-up")
	}
}

func TestBackups(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	var name string
	run(t, f, tests.ApiScenario{
		Name: "make one", Method: http.MethodPost, URL: "/api/whereis/admin/site/backups",
		Headers: asUser(t, f.dan), ExpectedStatus: 200,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			var out struct{ Name string }
			decode(t, res, &out)
			name = out.Name
		},
	})
	run(t, f, tests.ApiScenario{
		Name: "listed", Method: http.MethodGet, URL: "/api/whereis/admin/site/backups",
		Headers: asUser(t, f.dan), ExpectedStatus: 200, ExpectedContent: []string{`"name":"` + name + `"`},
	})
	tok, _ := f.dan.NewFileToken()
	run(t, f, tests.ApiScenario{
		Name: "download", Method: http.MethodGet, URL: "/api/whereis/admin/download/backup/" + name + "?token=" + tok,
		ExpectedStatus: 200, ExpectedContent: []string{"PK"},
	})
	annTok, _ := f.ann.NewFileToken()
	run(t, f, tests.ApiScenario{
		Name: "family admins can't download", Method: http.MethodGet, URL: "/api/whereis/admin/download/backup/" + name + "?token=" + annTok,
		ExpectedStatus: 403,
	})
	run(t, f, tests.ApiScenario{
		Name: "no path tricks", Method: http.MethodGet, URL: "/api/whereis/admin/download/backup/..%2Fdata.db?token=" + tok,
		ExpectedStatus: 404,
	})
	run(t, f, tests.ApiScenario{
		Name: "schedule", Method: http.MethodPut, URL: "/api/whereis/admin/site/backups/schedule",
		Headers: asUser(t, f.dan), Body: strings.NewReader(`{"every":"daily","keep":5}`), ExpectedStatus: 200,
		ExpectedContent: []string{`"cron":"0 3 * * *"`, `"keep":5`},
	})
	run(t, f, tests.ApiScenario{
		Name: "delete", Method: http.MethodDelete, URL: "/api/whereis/admin/site/backups/" + name,
		Headers: asUser(t, f.dan), ExpectedStatus: 204,
	})
}
