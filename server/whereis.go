package main

import (
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Config holds the settings read from the environment.
type Config struct {
	// GoogleClientID and GoogleClientSecret turn on "Sign in with Google".
	GoogleClientID     string
	GoogleClientSecret string
	// AndroidPackage and AndroidCertSHA256 (comma separated) are published in
	// /.well-known/assetlinks.json so tag links open the app directly.
	AndroidPackage    string
	AndroidCertSHA256 []string
	// AppDownloadURL is where the tag landing page sends people without the app.
	AppDownloadURL string
	// WebDir holds the web version of the app (the output of
	// `npx expo export --platform web`). When it has an index.html, the
	// server hosts the web app at / and label links open it.
	WebDir string
}

// ConfigFromEnv reads Config from environment variables.
func ConfigFromEnv(getenv func(string) string) Config {
	c := Config{
		GoogleClientID:     strings.TrimSpace(getenv("GOOGLE_CLIENT_ID")),
		GoogleClientSecret: strings.TrimSpace(getenv("GOOGLE_CLIENT_SECRET")),
		AndroidPackage:     strings.TrimSpace(getenv("ANDROID_PACKAGE")),
	}
	c.WebDir = strings.TrimSpace(getenv("WEB_DIR"))
	c.AppDownloadURL = strings.TrimSpace(getenv("APP_DOWNLOAD_URL"))
	if c.AppDownloadURL == "" {
		c.AppDownloadURL = "https://github.com/ssiuuk/where-is/releases/tag/android-latest"
	}
	if c.AndroidPackage == "" {
		c.AndroidPackage = "com.ssiuuk.whereis"
	}
	for _, fp := range strings.Split(getenv("ANDROID_CERT_SHA256"), ",") {
		if fp = strings.ToUpper(strings.TrimSpace(fp)); fp != "" {
			c.AndroidCertSHA256 = append(c.AndroidCertSHA256, fp)
		}
	}
	return c
}

// Register wires the Where Is routes and hooks into a PocketBase app.
func Register(app core.App, cfg Config) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := applyGoogleConfig(se.App, cfg); err != nil {
			return err
		}

		g := se.Router.Group("/api/whereis")
		g.Bind(apis.RequireAuth("users"))
		g.POST("/households", createHousehold)
		g.POST("/join", joinHousehold)
		g.POST("/leave", leaveHousehold)
		g.POST("/invite-code", rotateInviteCode)

		se.Router.GET("/.well-known/assetlinks.json", assetLinks(cfg))
		if hasWebApp(cfg.WebDir) {
			// the web app handles /, /p/<id>, /i/<id> and its other screens itself
			se.Router.GET("/{path...}", apis.Static(os.DirFS(cfg.WebDir), true))
		} else {
			se.Router.GET("/p/{id}", landingPage(cfg, "p"))
			se.Router.GET("/i/{id}", landingPage(cfg, "i"))
			se.Router.GET("/", homePage)
		}

		return se.Next()
	})

	// places and items must only point at records of the same household
	app.OnRecordCreateRequest("places").BindFunc(checkPlace)
	app.OnRecordUpdateRequest("places").BindFunc(checkPlace)
	app.OnRecordDeleteRequest("places").BindFunc(checkPlaceEmpty)

	app.OnRecordCreateRequest("items").BindFunc(trackMove)
	app.OnRecordUpdateRequest("items").BindFunc(trackMove)
}

func hasWebApp(dir string) bool {
	if dir == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(dir, "index.html"))
	return err == nil
}

// ---------------------------------------------------------------------
// households

const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O, 1/I

func newInviteCode() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = inviteAlphabet[int(b[i])%len(inviteAlphabet)]
	}
	return string(b[:4]) + "-" + string(b[4:])
}

// normalizeInviteCode accepts codes typed in any case, with or without the dash.
func normalizeInviteCode(s string) string {
	var out []byte
	for _, r := range strings.ToUpper(s) {
		if strings.ContainsRune(inviteAlphabet, r) {
			out = append(out, byte(r))
		}
	}
	if len(out) != 8 {
		return ""
	}
	return string(out[:4]) + "-" + string(out[4:])
}

func createHousehold(e *core.RequestEvent) error {
	var body struct {
		Name string `json:"name"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request.", err)
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		return e.BadRequestError("Give the household a name.", nil)
	}
	if e.Auth.GetString("household") != "" {
		return e.BadRequestError("You already belong to a household. Leave it first.", nil)
	}

	col, err := e.App.FindCollectionByNameOrId("households")
	if err != nil {
		return err
	}
	h := core.NewRecord(col)
	h.Set("name", body.Name)
	h.Set("invite_code", newInviteCode())
	h.Set("owner", e.Auth.Id)

	err = e.App.RunInTransaction(func(tx core.App) error {
		if err := tx.Save(h); err != nil {
			return err
		}
		user, err := tx.FindRecordById("users", e.Auth.Id)
		if err != nil {
			return err
		}
		user.Set("household", h.Id)
		return tx.Save(user)
	})
	if err != nil {
		return e.InternalServerError("Couldn't create the household.", err)
	}
	return e.JSON(http.StatusOK, h)
}

func joinHousehold(e *core.RequestEvent) error {
	var body struct {
		Code string `json:"code"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request.", err)
	}
	code := normalizeInviteCode(body.Code)
	if code == "" {
		return e.BadRequestError("An invite code has 8 letters and numbers, like ABCD-2345.", nil)
	}
	h, err := e.App.FindFirstRecordByData("households", "invite_code", code)
	if err != nil {
		return e.NotFoundError("No household has that invite code. Check it with the person who sent it.", nil)
	}
	user, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return err
	}
	user.Set("household", h.Id)
	if err := e.App.Save(user); err != nil {
		return e.InternalServerError("Couldn't join the household.", err)
	}
	return e.JSON(http.StatusOK, h)
}

func leaveHousehold(e *core.RequestEvent) error {
	user, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return err
	}
	user.Set("household", "")
	if err := e.App.Save(user); err != nil {
		return e.InternalServerError("Couldn't leave the household.", err)
	}
	return e.NoContent(http.StatusNoContent)
}

func rotateInviteCode(e *core.RequestEvent) error {
	hid := e.Auth.GetString("household")
	if hid == "" {
		return e.BadRequestError("You don't belong to a household yet.", nil)
	}
	h, err := e.App.FindRecordById("households", hid)
	if err != nil {
		return err
	}
	h.Set("invite_code", newInviteCode())
	if err := e.App.Save(h); err != nil {
		return e.InternalServerError("Couldn't change the invite code.", err)
	}
	return e.JSON(http.StatusOK, h)
}

// ---------------------------------------------------------------------
// places

func checkPlace(e *core.RecordRequestEvent) error {
	parentID := e.Record.GetString("parent")
	if parentID == "" {
		return e.Next()
	}
	if parentID == e.Record.Id {
		return e.BadRequestError("A place can't be inside itself.", nil)
	}
	household := e.Record.GetString("household")
	// walk up from the new parent; reaching this place again would make a loop
	seen := map[string]bool{}
	for id := parentID; id != ""; {
		if seen[id] || len(seen) > 100 {
			return e.BadRequestError("Those places are already nested in a loop.", nil)
		}
		seen[id] = true
		p, err := e.App.FindRecordById("places", id)
		if err != nil || p.GetString("household") != household {
			return e.BadRequestError("That place doesn't exist in your household.", nil)
		}
		if !e.Record.IsNew() && p.Id == e.Record.Id {
			return e.BadRequestError("A place can't go inside one of the places inside it.", nil)
		}
		id = p.GetString("parent")
	}
	return e.Next()
}

func checkPlaceEmpty(e *core.RecordRequestEvent) error {
	n, err := e.App.CountRecords("places", dbx.HashExp{"parent": e.Record.Id})
	if err != nil {
		return err
	}
	if n > 0 {
		return e.BadRequestError(fmt.Sprintf("Move or delete the %d place(s) inside it first.", n), nil)
	}
	n, err = e.App.CountRecords("items", dbx.HashExp{"place": e.Record.Id})
	if err != nil {
		return err
	}
	if n > 0 {
		return e.BadRequestError(fmt.Sprintf("Move the %d item(s) in it somewhere else first.", n), nil)
	}
	return e.Next()
}

// ---------------------------------------------------------------------
// items

// trackMove checks an item's place, stamps who moved it, and records the
// move in the history once the save succeeds.
func trackMove(e *core.RecordRequestEvent) error {
	household := e.Record.GetString("household")
	to := e.Record.GetString("place")
	from := ""
	if !e.Record.IsNew() {
		from = e.Record.Original().GetString("place")
	}

	if to != "" && to != from {
		p, err := e.App.FindRecordById("places", to)
		if err != nil || p.GetString("household") != household {
			return e.BadRequestError("That place doesn't exist in your household.", nil)
		}
	}

	moved := to != from
	if moved {
		e.Record.Set("moved_at", types.NowDateTime())
		if e.Auth != nil && e.Auth.Collection().Name == "users" {
			e.Record.Set("moved_by", e.Auth.Id)
		}
	}

	if err := e.Next(); err != nil {
		return err
	}
	if !moved {
		return nil
	}

	col, err := e.App.FindCollectionByNameOrId("moves")
	if err != nil {
		return err
	}
	m := core.NewRecord(col)
	m.Set("household", household)
	m.Set("item", e.Record.Id)
	m.Set("from_place", from)
	m.Set("to_place", to)
	m.Set("by", e.Record.GetString("moved_by"))
	if err := e.App.Save(m); err != nil {
		// the item itself is saved; a missing history row shouldn't fail the request
		e.App.Logger().Error("Failed to record item move", "item", e.Record.Id, "error", err)
	}
	return nil
}

// ---------------------------------------------------------------------
// Google sign-in

func applyGoogleConfig(app core.App, cfg Config) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	if cfg.GoogleClientID == "" || cfg.GoogleClientSecret == "" {
		// leave whatever was set in the admin UI alone
		return nil
	}
	found := false
	for i, p := range users.OAuth2.Providers {
		if p.Name == "google" {
			users.OAuth2.Providers[i].ClientId = cfg.GoogleClientID
			users.OAuth2.Providers[i].ClientSecret = cfg.GoogleClientSecret
			found = true
		}
	}
	if !found {
		users.OAuth2.Providers = append(users.OAuth2.Providers, core.OAuth2ProviderConfig{
			Name:         "google",
			ClientId:     cfg.GoogleClientID,
			ClientSecret: cfg.GoogleClientSecret,
		})
	}
	users.OAuth2.Enabled = true
	if err := app.Save(users); err != nil {
		return errors.Join(errors.New("couldn't turn on Google sign-in"), err)
	}
	return nil
}
