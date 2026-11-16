package main

import (
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
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
	// PublicURL is the address people use to reach the server, such as
	// https://whereis.example.com. Links in emails (password reset) use it.
	PublicURL string
	// Mail is the email server used for password reset emails.
	Mail MailConfig
	// SignupClosed stops new accounts (email sign-up and first-time Google
	// sign-in). Existing accounts still sign in, and a superuser can still
	// create accounts in the dashboard. Set with ALLOW_SIGNUP=false.
	SignupClosed bool
	// SignupLocked is true when ALLOW_SIGNUP is set at all: .env then decides,
	// and the site admin's switch is shown but can't be changed.
	SignupLocked bool
	// AdminEmails (ADMIN_EMAILS, comma separated, lowercased) are the site
	// admins: whoever signs in with one of these verified emails.
	AdminEmails []string
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
	c.PublicURL = strings.TrimRight(strings.TrimSpace(getenv("PUBLIC_URL")), "/")
	if c.PublicURL == "" {
		if d := strings.TrimSpace(getenv("WHEREIS_DOMAIN")); d != "" {
			c.PublicURL = "https://" + d
		}
	}
	c.Mail = MailConfig{
		Host:        strings.TrimSpace(getenv("SMTP_HOST")),
		Username:    strings.TrimSpace(getenv("SMTP_USERNAME")),
		Password:    getenv("SMTP_PASSWORD"),
		FromAddress: strings.TrimSpace(getenv("MAIL_FROM_ADDRESS")),
		FromName:    strings.TrimSpace(getenv("MAIL_FROM_NAME")),
	}
	if raw := strings.TrimSpace(getenv("SMTP_PORT")); raw == "" {
		c.Mail.Port = 587
	} else if port, err := strconv.Atoi(raw); err == nil {
		c.Mail.Port = port
	} else {
		c.Mail.Port = -1 // not a number: refused when the mail settings are applied
	}
	switch strings.ToLower(strings.TrimSpace(getenv("SMTP_TLS"))) {
	case "true", "1", "yes", "on":
		c.Mail.TLS = true
	case "false", "0", "no", "off":
	default:
		c.Mail.TLS = c.Mail.Port == 465
	}
	switch strings.ToLower(strings.TrimSpace(getenv("SMTP_STARTTLS"))) {
	case "false", "0", "no", "off":
		c.Mail.NoStartTLS = true
	}
	switch strings.ToLower(strings.TrimSpace(getenv("SMTP_TLS_VERIFY"))) {
	case "false", "0", "no", "off":
		c.Mail.SkipVerify = true
	}
	if c.Mail.FromName == "" {
		c.Mail.FromName = "Where Is"
	}
	switch strings.ToLower(strings.TrimSpace(getenv("ALLOW_SIGNUP"))) {
	case "false", "0", "no", "off":
		c.SignupClosed = true
		c.SignupLocked = true
	case "true", "1", "yes", "on":
		c.SignupLocked = true
	}
	for _, email := range strings.Split(getenv("ADMIN_EMAILS"), ",") {
		if email = strings.ToLower(strings.TrimSpace(email)); email != "" {
			c.AdminEmails = append(c.AdminEmails, email)
		}
	}
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

// MailConfig comes from SMTP_* and MAIL_FROM_* in .env. When Host is empty
// the server leaves whatever was set in the dashboard alone.
type MailConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	TLS      bool // implicit TLS (usually port 465); otherwise STARTTLS is used when offered
	// NoStartTLS (SMTP_STARTTLS=false) sends in plain text even when the
	// server offers STARTTLS: for a mail server on the home network.
	NoStartTLS bool
	// SkipVerify (SMTP_TLS_VERIFY=false) accepts any certificate from the
	// mail server, such as an internal server's self-signed one.
	SkipVerify  bool
	FromAddress string
	FromName    string
}

// Register wires the Where Is routes and hooks into a PocketBase app.
func Register(app core.App, cfg Config) {
	logMail(app, cfg)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := applyGoogleConfig(se.App, cfg); err != nil {
			return err
		}
		if err := applyMailConfig(se.App, cfg); err != nil {
			return err
		}

		g := se.Router.Group("/api/whereis")
		g.Bind(apis.RequireAuth("users"))
		g.POST("/households", createHousehold)
		g.POST("/join", joinHousehold)
		g.POST("/leave", leaveHousehold)
		g.POST("/invite-code", rotateInviteCode)
		g.POST("/move", moveItems)

		// public: what the sign-in screen should offer
		se.Router.GET("/api/whereis/config", func(e *core.RequestEvent) error {
			return e.JSON(http.StatusOK, map[string]any{"signup": signupOpen(e.App, cfg)})
		})
		registerAdminRoutes(se, cfg)

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

	// new accounts: ALLOW_SIGNUP in .env, or the site admin's switch
	app.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() || signupOpen(e.App, cfg) {
			return e.Next()
		}
		return e.ForbiddenError(errSignupClosed, nil)
	})
	app.OnRecordAuthWithOAuth2Request("users").BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		if e.IsNewRecord && !signupOpen(e.App, cfg) {
			return e.ForbiddenError(errSignupClosed, nil)
		}
		return e.Next()
	})

	// places and items must only point at records of the same household
	app.OnRecordCreateRequest("places").BindFunc(checkPlace)
	app.OnRecordUpdateRequest("places").BindFunc(checkPlace)
	app.OnRecordDeleteRequest("places").BindFunc(checkPlaceEmpty)

	app.OnRecordCreateRequest("items").BindFunc(trackMove)
	app.OnRecordUpdateRequest("items").BindFunc(trackMove)

	// tags and aliases are tidied on every save, from any client
	app.OnRecordCreate("items").BindFunc(tidyItemNames)
	app.OnRecordUpdate("items").BindFunc(tidyItemNames)

	// after the checks above: activity log, recycle bin, turned-off accounts
	bindAdminHooks(app, cfg)
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

const errSignupClosed = "New accounts are turned off on this server. Ask whoever runs it to create one for you."

var errAlreadyMember = errors.New("You already belong to a household. Leave it in Settings before joining another.")

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
	col, err := e.App.FindCollectionByNameOrId("households")
	if err != nil {
		return err
	}
	h := core.NewRecord(col)
	h.Set("name", body.Name)
	h.Set("invite_code", newInviteCode())
	h.Set("owner", e.Auth.Id)

	err = e.App.RunInTransaction(func(tx core.App) error {
		user, err := tx.FindRecordById("users", e.Auth.Id)
		if err != nil {
			return err
		}
		if user.GetString("household") != "" {
			return errAlreadyMember
		}
		if err := tx.Save(h); err != nil {
			return err
		}
		user.Set("household", h.Id)
		return tx.Save(user)
	})
	if errors.Is(err, errAlreadyMember) {
		return e.BadRequestError(errAlreadyMember.Error(), nil)
	}
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
	if h.GetBool("invites_off") && e.Auth.GetString("household") != h.Id {
		return e.ForbiddenError("That household isn't taking new members right now. Ask its family admin to turn invites back on.", nil)
	}
	err = e.App.RunInTransaction(func(tx core.App) error {
		user, err := tx.FindRecordById("users", e.Auth.Id)
		if err != nil {
			return err
		}
		switch user.GetString("household") {
		case h.Id:
			return nil // already in it
		case "":
			user.Set("household", h.Id)
			return tx.Save(user)
		default:
			// one household at a time: switching means leaving on purpose first
			return errAlreadyMember
		}
	})
	if errors.Is(err, errAlreadyMember) {
		return e.BadRequestError(errAlreadyMember.Error(), nil)
	}
	if err != nil {
		return e.InternalServerError("Couldn't join the household.", err)
	}
	return e.JSON(http.StatusOK, h)
}

func leaveHousehold(e *core.RequestEvent) error {
	user, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return err
	}
	err = e.App.RunInTransaction(func(tx core.App) error {
		if err := handOverIfOwner(tx, user); err != nil {
			return err
		}
		user.Set("household", "")
		return tx.Save(user)
	})
	if err != nil {
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
// move in the history. The item and its history row are saved in one
// transaction: if the history can't be written, the move fails too.
func trackMove(e *core.RecordRequestEvent) error {
	household := e.Record.GetString("household")
	to := e.Record.GetString("place")
	from := ""
	if !e.Record.IsNew() {
		from = e.Record.Original().GetString("place")
	}
	if to == from {
		return e.Next()
	}
	if to != "" {
		p, err := e.App.FindRecordById("places", to)
		if err != nil || p.GetString("household") != household {
			return e.BadRequestError("That place doesn't exist in your household.", nil)
		}
	}

	by := ""
	if e.Auth != nil && e.Auth.Collection().Name == "users" {
		by = e.Auth.Id
	}
	// clients can't send these (see the items API rules); the server sets them
	e.Record.Set("moved_by", by)
	e.Record.Set("moved_at", types.NowDateTime())

	return e.App.RunInTransaction(func(tx core.App) error {
		e.App = tx
		if err := e.Next(); err != nil {
			return err
		}
		return saveMove(tx, e.Record, from, to, by)
	})
}

// saveMove writes one history row. Place names are copied in too, so the
// history still reads well after a place is renamed or deleted.
func saveMove(app core.App, item *core.Record, from, to, by string) error {
	col, err := app.FindCollectionByNameOrId("moves")
	if err != nil {
		return err
	}
	m := core.NewRecord(col)
	m.Set("household", item.GetString("household"))
	m.Set("item", item.Id)
	m.Set("from_place", from)
	m.Set("to_place", to)
	m.Set("from_name", placePathName(app, from))
	m.Set("to_name", placePathName(app, to))
	m.Set("by", by)
	return app.Save(m)
}

// placePathName returns e.g. "Garage › Shelf 3", or "" for no place.
func placePathName(app core.App, id string) string {
	var names []string
	seen := map[string]bool{}
	for id != "" && !seen[id] && len(seen) < 50 {
		seen[id] = true
		p, err := app.FindRecordById("places", id)
		if err != nil {
			break
		}
		names = append([]string{p.GetString("name")}, names...)
		id = p.GetString("parent")
	}
	return strings.Join(names, " › ")
}

// moveItems moves several items to one place, all or nothing: either every
// item moves and gets its history row, or nothing changes.
func moveItems(e *core.RequestEvent) error {
	var body struct {
		Items []string `json:"items"`
		Place string   `json:"place"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request.", err)
	}
	if len(body.Items) == 0 || len(body.Items) > 200 {
		return e.BadRequestError("Choose between 1 and 200 items to move.", nil)
	}
	user, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return err
	}
	household := user.GetString("household")
	if household == "" {
		return e.BadRequestError("You don't belong to a household yet.", nil)
	}
	if body.Place != "" {
		p, err := e.App.FindRecordById("places", body.Place)
		if err != nil || p.GetString("household") != household {
			return e.BadRequestError("That place doesn't exist in your household.", nil)
		}
	}

	moved := make([]*core.Record, 0, len(body.Items))
	err = e.App.RunInTransaction(func(tx core.App) error {
		seen := map[string]bool{}
		for _, id := range body.Items {
			if seen[id] {
				continue
			}
			seen[id] = true
			item, err := tx.FindRecordById("items", id)
			if err != nil || item.GetString("household") != household {
				return e.NotFoundError("One of those items isn't in your household. Nothing was moved.", nil)
			}
			from := item.GetString("place")
			if from != body.Place {
				item.Set("place", body.Place)
				item.Set("moved_by", user.Id)
				item.Set("moved_at", types.NowDateTime())
				if err := tx.Save(item); err != nil {
					return err
				}
				if err := saveMove(tx, item, from, body.Place, user.Id); err != nil {
					return err
				}
				logActivity(tx, household, user.Id, "moved", "item", item.Id, item.GetString("name"),
					placeOrNone(tx, from)+" → "+placeOrNone(tx, body.Place))
			}
			moved = append(moved, item)
		}
		return nil
	})
	if err != nil {
		var apiErr *router.ApiError
		if errors.As(err, &apiErr) {
			return apiErr
		}
		return e.InternalServerError("Couldn't move the items. Nothing was moved.", err)
	}
	return e.JSON(http.StatusOK, moved)
}

// ---------------------------------------------------------------------
// Google sign-in

// applyMailConfig copies the .env email and address settings into
// PocketBase's settings, so password reset emails work without the dashboard.
func applyMailConfig(app core.App, cfg Config) error {
	if cfg.PublicURL == "" && cfg.Mail.Host == "" {
		return nil
	}
	settings := app.Settings()
	if cfg.PublicURL != "" {
		settings.Meta.AppURL = cfg.PublicURL
	}
	if m := cfg.Mail; m.Host != "" {
		if m.Port < 1 || m.Port > 65535 {
			return errors.New("SMTP_PORT must be a port number from 1 to 65535, usually 587 or 465")
		}
		if m.FromAddress == "" {
			return errors.New("SMTP_HOST is set but MAIL_FROM_ADDRESS is empty: set the address password reset emails come from")
		}
		settings.SMTP.Enabled = true
		settings.SMTP.Host = m.Host
		settings.SMTP.Port = m.Port
		settings.SMTP.Username = m.Username
		settings.SMTP.Password = m.Password
		settings.SMTP.TLS = m.TLS
		settings.Meta.SenderAddress = m.FromAddress
		settings.Meta.SenderName = m.FromName
	}
	if err := app.Save(settings); err != nil {
		return errors.Join(errors.New("couldn't save the email settings"), err)
	}
	return nil
}

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
	// the site admin can turn Google sign-in off from the admin screen
	users.OAuth2.Enabled = !googleTurnedOff(app)
	if err := app.Save(users); err != nil {
		return errors.Join(errors.New("couldn't turn on Google sign-in"), err)
	}
	return nil
}
