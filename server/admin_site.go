package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/mailer"
	"github.com/pocketbase/pocketbase/tools/routine"
	"github.com/pocketbase/pocketbase/tools/security"
	"github.com/pocketbase/pocketbase/tools/subscriptions"
)

// ---------------------------------------------------------------------
// settings changed from the admin screens

func readSetting(app core.App, key string, out any) bool {
	r, err := app.FindFirstRecordByData("server_settings", "key", key)
	if err != nil {
		return false
	}
	return r.UnmarshalJSONField("value", out) == nil
}

func writeSetting(app core.App, key string, value any) error {
	r, err := app.FindFirstRecordByData("server_settings", "key", key)
	if err != nil {
		col, err := app.FindCollectionByNameOrId("server_settings")
		if err != nil {
			return err
		}
		r = core.NewRecord(col)
		r.Set("key", key)
	}
	r.Set("value", value)
	return app.Save(r)
}

// signupOpen decides whether new accounts can be made. ALLOW_SIGNUP in .env
// wins when it is set; otherwise the site admin's switch decides (open
// until they close it).
func signupOpen(app core.App, cfg Config) bool {
	if cfg.SignupLocked || cfg.SignupClosed {
		return !cfg.SignupClosed
	}
	open := true
	readSetting(app, "signup", &open)
	return open
}

func googleTurnedOff(app core.App) bool {
	off := false
	readSetting(app, "google_off", &off)
	return off
}

// ---------------------------------------------------------------------
// overview

func siteOverview(cfg Config) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		s := e.App.Settings()
		return e.JSON(http.StatusOK, map[string]any{
			"signup": map[string]any{"open": signupOpen(e.App, cfg), "locked": cfg.SignupLocked || cfg.SignupClosed},
			"mail": map[string]any{
				"enabled":     s.SMTP.Enabled,
				"host":        s.SMTP.Host,
				"port":        s.SMTP.Port,
				"username":    s.SMTP.Username,
				"hasPassword": s.SMTP.Password != "",
				"tls":         s.SMTP.TLS,
				"fromAddress": s.Meta.SenderAddress,
				"fromName":    s.Meta.SenderName,
				"locked":      cfg.Mail.Host != "",
			},
			"google":  googleStatus(e.App, cfg),
			"appUrl":  s.Meta.AppURL,
			"admins":  cfg.AdminEmails,
			"backups": map[string]any{"cron": s.Backups.Cron, "keep": s.Backups.CronMaxKeep},
		})
	}
}

// ---------------------------------------------------------------------
// sign-up

func siteSignup(cfg Config) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Open bool `json:"open"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request.", err)
		}
		if cfg.SignupLocked || cfg.SignupClosed {
			return e.BadRequestError("ALLOW_SIGNUP is set in .env, so it decides. Remove it from .env to use this switch.", nil)
		}
		if err := writeSetting(e.App, "signup", body.Open); err != nil {
			return e.InternalServerError("Couldn't save the setting.", err)
		}
		return e.JSON(http.StatusOK, map[string]any{"open": body.Open})
	}
}

// ---------------------------------------------------------------------
// mail

func siteMail(cfg Config) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if cfg.Mail.Host != "" {
			return e.BadRequestError("The mail server is set in .env (SMTP_HOST), so change it there.", nil)
		}
		var body struct {
			Enabled     bool    `json:"enabled"`
			Host        string  `json:"host"`
			Port        int     `json:"port"`
			Username    string  `json:"username"`
			Password    *string `json:"password"` // left out: keep the saved one
			TLS         bool    `json:"tls"`
			FromAddress string  `json:"fromAddress"`
			FromName    string  `json:"fromName"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request.", err)
		}
		body.Host = strings.TrimSpace(body.Host)
		body.FromAddress = strings.TrimSpace(body.FromAddress)
		if body.Enabled {
			if body.Host == "" {
				return e.BadRequestError("Enter the mail server's address.", nil)
			}
			if _, err := mail.ParseAddress(body.FromAddress); err != nil {
				return e.BadRequestError("Enter the address emails come from, like whereis@example.com.", nil)
			}
		}
		if body.Port == 0 {
			body.Port = 587
		}
		s := e.App.Settings()
		s.SMTP.Enabled = body.Enabled
		s.SMTP.Host = body.Host
		s.SMTP.Port = body.Port
		s.SMTP.Username = strings.TrimSpace(body.Username)
		if body.Password != nil {
			s.SMTP.Password = *body.Password
		}
		s.SMTP.TLS = body.TLS
		if body.FromAddress != "" {
			s.Meta.SenderAddress = body.FromAddress
		}
		if n := strings.TrimSpace(body.FromName); n != "" {
			s.Meta.SenderName = n
		}
		if err := e.App.Save(s); err != nil {
			return e.BadRequestError("Couldn't save the mail settings: "+err.Error(), err)
		}
		return siteOverview(cfg)(e)
	}
}

func siteMailTest(e *core.RequestEvent) error {
	var body struct {
		To string `json:"to"`
	}
	_ = e.BindBody(&body)
	to := strings.TrimSpace(body.To)
	if to == "" {
		to = e.Auth.Email()
	}
	addr, err := mail.ParseAddress(to)
	if err != nil {
		return e.BadRequestError("Enter an email address to send the test to.", nil)
	}
	s := e.App.Settings()
	if !s.SMTP.Enabled {
		return e.BadRequestError("Turn on and save the mail settings first.", nil)
	}
	msg := &mailer.Message{
		From:    mail.Address{Name: s.Meta.SenderName, Address: s.Meta.SenderAddress},
		To:      []mail.Address{*addr},
		Subject: "Where Is test email",
		HTML:    "<p>This is a test email from your Where Is server. Email works, so “Forgot password?” emails will arrive.</p>",
		Text:    "This is a test email from your Where Is server. Email works, so \"Forgot password?\" emails will arrive.",
	}
	if err := e.App.NewMailClient().Send(msg); err != nil {
		return e.BadRequestError("The mail server didn't take the email: "+err.Error(), nil)
	}
	return e.JSON(http.StatusOK, map[string]any{"to": addr.Address})
}

// ---------------------------------------------------------------------
// Google sign-in

func googleProvider(app core.App) (core.OAuth2ProviderConfig, *core.Collection, bool) {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return core.OAuth2ProviderConfig{}, nil, false
	}
	for _, p := range users.OAuth2.Providers {
		if p.Name == "google" {
			return p, users, true
		}
	}
	return core.OAuth2ProviderConfig{}, users, false
}

func redirectURL(app core.App) string {
	if u := strings.TrimRight(app.Settings().Meta.AppURL, "/"); u != "" && !strings.Contains(u, "localhost") {
		return u + "/api/oauth2-redirect"
	}
	return ""
}

func googleStatus(app core.App, cfg Config) map[string]any {
	p, users, found := googleProvider(app)
	enabled := found && users != nil && users.OAuth2.Enabled && p.ClientId != "" && p.ClientSecret != ""
	return map[string]any{
		"enabled":     enabled,
		"configured":  found && p.ClientId != "" && p.ClientSecret != "",
		"clientId":    p.ClientId,
		"locked":      cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "",
		"redirectUrl": redirectURL(app),
	}
}

func siteGoogle(cfg Config) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Enabled      bool   `json:"enabled"`
			ClientID     string `json:"clientId"`
			ClientSecret string `json:"clientSecret"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request.", err)
		}
		locked := cfg.GoogleClientID != "" && cfg.GoogleClientSecret != ""
		if locked && (body.ClientID != "" || body.ClientSecret != "") {
			return e.BadRequestError("The Google client ID and secret are set in .env, so change them there.", nil)
		}
		p, users, found := googleProvider(e.App)
		if users == nil {
			return e.InternalServerError("Couldn't load the accounts settings.", nil)
		}
		if id := strings.TrimSpace(body.ClientID); id != "" {
			p.ClientId = id
		}
		if secret := strings.TrimSpace(body.ClientSecret); secret != "" {
			p.ClientSecret = secret
		}
		if body.Enabled && (p.ClientId == "" || p.ClientSecret == "") {
			return e.BadRequestError("Enter the Google client ID and secret first.", nil)
		}
		p.Name = "google"
		if found {
			for i := range users.OAuth2.Providers {
				if users.OAuth2.Providers[i].Name == "google" {
					users.OAuth2.Providers[i] = p
				}
			}
		} else if p.ClientId != "" {
			users.OAuth2.Providers = append(users.OAuth2.Providers, p)
		}
		users.OAuth2.Enabled = body.Enabled
		if err := e.App.Save(users); err != nil {
			return e.BadRequestError("Couldn't save Google sign-in: "+err.Error(), err)
		}
		if err := writeSetting(e.App, "google_off", !body.Enabled); err != nil {
			return e.InternalServerError("Couldn't save the setting.", err)
		}
		return e.JSON(http.StatusOK, googleStatus(e.App, cfg))
	}
}

// googleTokenURL is replaced in tests.
var googleTokenURL = "https://oauth2.googleapis.com/token"

// siteGoogleCheck asks Google whether it knows the client ID and secret,
// by trading a made-up sign-in code. Google answers "invalid_grant" when
// the client is right (only the code is wrong) and "invalid_client" when
// the ID or secret is wrong.
func siteGoogleCheck(cfg Config) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		p, _, found := googleProvider(e.App)
		var problems []string
		if !found || p.ClientId == "" || p.ClientSecret == "" {
			return e.JSON(http.StatusOK, map[string]any{"ok": false, "problems": []string{"No Google client ID and secret are set."}})
		}
		redirect := redirectURL(e.App)
		if redirect == "" {
			problems = append(problems, "The server doesn't know its public address. Set PUBLIC_URL in .env, so Google can send people back to it.")
		}
		form := url.Values{
			"code": {"whereis-check"}, "grant_type": {"authorization_code"},
			"client_id": {p.ClientId}, "client_secret": {p.ClientSecret}, "redirect_uri": {redirect},
		}
		ctx, cancel := context.WithTimeout(e.Request.Context(), 10*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, googleTokenURL, strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			problems = append(problems, "Couldn't reach Google from the server: "+err.Error())
			return e.JSON(http.StatusOK, map[string]any{"ok": false, "problems": problems, "redirectUrl": redirect})
		}
		defer res.Body.Close()
		var answer struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		raw, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		_ = json.Unmarshal(raw, &answer)
		switch answer.Error {
		case "invalid_grant":
			// the client is fine
		case "invalid_client", "unauthorized_client":
			problems = append(problems, "Google doesn't accept the client ID and secret. Copy them again from Google Cloud console.")
		case "redirect_uri_mismatch":
			problems = append(problems, "Add "+redirect+" to the client's authorized redirect URIs in Google Cloud console.")
		default:
			problems = append(problems, "Google answered: "+strings.TrimSpace(answer.Error+" "+answer.Description))
		}
		if users, err := e.App.FindCollectionByNameOrId("users"); err == nil && !users.OAuth2.Enabled {
			problems = append(problems, "Google sign-in is turned off.")
		}
		return e.JSON(http.StatusOK, map[string]any{"ok": len(problems) == 0, "problems": problems, "redirectUrl": redirect})
	}
}

// ---------------------------------------------------------------------
// accounts

type accountInfo struct {
	memberInfo
	Household   string `json:"household"`
	Verified    bool   `json:"verified"`
	SiteAdmin   bool   `json:"site_admin"`
	FamilyAdmin bool   `json:"family_admin"`
}

func siteUsers(cfg Config) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		users, err := e.App.FindRecordsByFilter("users", "", "created", 0, 0)
		if err != nil {
			return err
		}
		households, err := e.App.FindAllRecords("households")
		if err != nil {
			return err
		}
		names := map[string]string{}
		owners := map[string]string{}
		for _, h := range households {
			names[h.Id] = h.GetString("name")
			owners[h.Id] = h.GetString("owner")
		}
		out := make([]accountInfo, 0, len(users))
		for _, u := range users {
			hid := u.GetString("household")
			info := accountInfo{
				memberInfo:  toMemberInfo(e.App, u, owners[hid]),
				Household:   names[hid],
				Verified:    u.Verified(),
				SiteAdmin:   listedAdmin(cfg, u),
				FamilyAdmin: hid != "" && owners[hid] == u.Id,
			}
			out = append(out, info)
		}
		sort.SliceStable(out, func(i, j int) bool { return out[i].Household < out[j].Household })
		return e.JSON(http.StatusOK, out)
	}
}

// siteAccount finds the account in the path that a site admin may change:
// not their own, and not another listed admin.
func siteAccount(e *core.RequestEvent, cfg Config) (*core.Record, error) {
	u, err := e.App.FindRecordById("users", e.Request.PathValue("id"))
	if err != nil {
		return nil, e.NotFoundError("That account doesn't exist.", nil)
	}
	if u.Id == e.Auth.Id {
		return nil, e.BadRequestError("You can't do that to your own account here.", nil)
	}
	if listedAdmin(cfg, u) {
		return nil, e.BadRequestError("That account is a site admin (listed in ADMIN_EMAILS). Remove it from .env first.", nil)
	}
	return u, nil
}

func siteUpdateUser(cfg Config) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		u, err := siteAccount(e, cfg)
		if err != nil {
			return err
		}
		var body struct {
			Disabled *bool `json:"disabled"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request.", err)
		}
		if body.Disabled != nil {
			u.Set("disabled", *body.Disabled)
			if *body.Disabled {
				// sign them out everywhere
				u.RefreshTokenKey()
				if err := handOverIfOwner(e.App, u); err != nil {
					return e.InternalServerError("Couldn't hand over their household.", err)
				}
			}
		}
		// found before saving: the new token key makes PocketBase sign these
		// connections out, after which they no longer show whose they were
		live := realtimeClientsOf(e.App, u.Id)
		if err := e.App.Save(u); err != nil {
			return e.InternalServerError("Couldn't save the account.", err)
		}
		if body.Disabled != nil && *body.Disabled {
			for _, c := range live {
				c.Discard()
			}
		}
		return e.NoContent(http.StatusNoContent)
	}
}

// realtimeClientsOf lists the live-update connections signed in as userID,
// so a turned-off or deleted account's can be closed.
func realtimeClientsOf(app core.App, userID string) []subscriptions.Client {
	var out []subscriptions.Client
	for _, c := range app.SubscriptionsBroker().Clients() {
		if auth, ok := c.Get(apis.RealtimeClientAuthKey).(*core.Record); ok && auth.Id == userID {
			out = append(out, c)
		}
	}
	return out
}

func siteDeleteUser(cfg Config) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		u, err := siteAccount(e, cfg)
		if err != nil {
			return err
		}
		// found before deleting: PocketBase signs these connections out when
		// the account goes, after which they no longer show whose they were
		live := realtimeClientsOf(e.App, u.Id)
		err = e.App.RunInTransaction(func(tx core.App) error {
			if err := handOverIfOwner(tx, u); err != nil {
				return err
			}
			return tx.Delete(u)
		})
		if err != nil {
			return e.InternalServerError("Couldn't delete the account.", err)
		}
		// close them, rather than leave them connected as signed-out guests
		for _, c := range live {
			c.Discard()
		}
		return e.NoContent(http.StatusNoContent)
	}
}

// siteSetPassword gives an account a new random password for the admin to
// pass on. It signs that person out everywhere.
func siteSetPassword(cfg Config) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		u, err := siteAccount(e, cfg)
		if err != nil {
			return err
		}
		pw := security.RandomStringWithAlphabet(4, "abcdefghjkmnpqrstuvwxyz") + "-" +
			security.RandomStringWithAlphabet(4, "abcdefghjkmnpqrstuvwxyz23456789") + "-" +
			security.RandomStringWithAlphabet(4, "abcdefghjkmnpqrstuvwxyz23456789")
		u.SetPassword(pw)
		if err := e.App.Save(u); err != nil {
			return e.InternalServerError("Couldn't set the password.", err)
		}
		return e.JSON(http.StatusOK, map[string]any{"password": pw})
	}
}

func siteResetEmail(e *core.RequestEvent) error {
	u, err := e.App.FindRecordById("users", e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("That account doesn't exist.", nil)
	}
	return sendResetEmail(e, u)
}

// ---------------------------------------------------------------------
// backups

func validBackupName(name string) bool {
	return name != "" && filepath.Base(name) == name && strings.HasSuffix(strings.ToLower(name), ".zip") && !strings.HasPrefix(name, ".")
}

func listBackups(e *core.RequestEvent) error {
	fsys, err := e.App.NewBackupsFilesystem()
	if err != nil {
		return e.InternalServerError("Couldn't open the backups folder.", err)
	}
	defer fsys.Close()
	objs, err := fsys.List("")
	if err != nil {
		return e.InternalServerError("Couldn't list the backups.", err)
	}
	out := []map[string]any{}
	for _, o := range objs {
		if !validBackupName(o.Key) {
			continue
		}
		out = append(out, map[string]any{"name": o.Key, "size": o.Size, "modified": o.ModTime.UTC().Format(time.RFC3339)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i]["modified"].(string) > out[j]["modified"].(string) })
	s := e.App.Settings()
	return e.JSON(http.StatusOK, map[string]any{
		"backups": out,
		"cron":    s.Backups.Cron,
		"keep":    s.Backups.CronMaxKeep,
		"busy":    e.App.Store().Has(core.StoreKeyActiveBackup),
	})
}

func createBackup(e *core.RequestEvent) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	name := "whereis_" + time.Now().UTC().Format("20060102_150405") + ".zip"
	if err := e.App.CreateBackup(ctx, name); err != nil {
		return e.BadRequestError("Couldn't make the backup: "+err.Error(), nil)
	}
	return e.JSON(http.StatusOK, map[string]any{"name": name})
}

func downloadBackup(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	if !validBackupName(name) {
		return e.NotFoundError("No such backup.", nil)
	}
	fsys, err := e.App.NewBackupsFilesystem()
	if err != nil {
		return e.InternalServerError("Couldn't open the backups folder.", err)
	}
	defer fsys.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	fsys.SetContext(ctx)
	if ok, _ := fsys.Exists(name); !ok {
		return e.NotFoundError("No such backup.", nil)
	}
	e.Response.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	return fsys.Serve(e.Response, e.Request, name, name)
}

func deleteBackup(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	if !validBackupName(name) {
		return e.NotFoundError("No such backup.", nil)
	}
	fsys, err := e.App.NewBackupsFilesystem()
	if err != nil {
		return e.InternalServerError("Couldn't open the backups folder.", err)
	}
	defer fsys.Close()
	if err := fsys.Delete(name); err != nil {
		return e.BadRequestError("Couldn't delete the backup.", err)
	}
	return e.NoContent(http.StatusNoContent)
}

func uploadBackup(e *core.RequestEvent) error {
	files, err := e.FindUploadedFiles("file")
	if err != nil || len(files) == 0 {
		return e.BadRequestError("Choose a backup .zip file.", nil)
	}
	f := files[0]
	name := filepath.Base(f.OriginalName)
	if !validBackupName(name) {
		return e.BadRequestError("A backup is a .zip file made by this server.", nil)
	}
	fsys, err := e.App.NewBackupsFilesystem()
	if err != nil {
		return e.InternalServerError("Couldn't open the backups folder.", err)
	}
	defer fsys.Close()
	if ok, _ := fsys.Exists(name); ok {
		return e.BadRequestError("A backup with that name is already on the server.", nil)
	}
	if err := fsys.UploadFile(f, name); err != nil {
		return e.BadRequestError("Couldn't upload the backup.", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"name": name})
}

// scheduleBackups sets automatic backups: off, daily or weekly at 03:00
// server time, keeping the newest few.
func scheduleBackups(e *core.RequestEvent) error {
	var body struct {
		Every string `json:"every"` // off, daily or weekly
		Keep  int    `json:"keep"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request.", err)
	}
	s := e.App.Settings()
	switch body.Every {
	case "off":
		s.Backups.Cron = ""
	case "daily":
		s.Backups.Cron = "0 3 * * *"
	case "weekly":
		s.Backups.Cron = "0 3 * * 0"
	default:
		return e.BadRequestError("Choose off, daily or weekly.", nil)
	}
	if body.Keep < 1 {
		body.Keep = 7
	}
	if body.Keep > 100 {
		body.Keep = 100
	}
	s.Backups.CronMaxKeep = body.Keep
	if err := e.App.Save(s); err != nil {
		return e.BadRequestError("Couldn't save the schedule: "+err.Error(), err)
	}
	return e.JSON(http.StatusOK, map[string]any{"cron": s.Backups.Cron, "keep": s.Backups.CronMaxKeep})
}

// restoreBackup replaces everything with a backup and restarts the server.
// It runs after the answer is sent, since the restart drops connections.
func restoreBackup(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	if !validBackupName(name) {
		return e.NotFoundError("No such backup.", nil)
	}
	fsys, err := e.App.NewBackupsFilesystem()
	if err != nil {
		return e.InternalServerError("Couldn't open the backups folder.", err)
	}
	exists, _ := fsys.Exists(name)
	fsys.Close()
	if !exists {
		return e.NotFoundError("No such backup.", nil)
	}
	if e.App.Store().Has(core.StoreKeyActiveBackup) {
		return e.BadRequestError("A backup is being made or restored right now. Try again in a minute.", nil)
	}
	app := e.App
	routine.FireAndForget(func() {
		time.Sleep(500 * time.Millisecond) // let the answer reach the app first
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		if err := app.RestoreBackup(ctx, name); err != nil {
			app.Logger().Error("couldn't restore the backup", "name", name, "error", err)
		}
	})
	return e.NoContent(http.StatusAccepted)
}
