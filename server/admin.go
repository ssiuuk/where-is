package main

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/mails"
	"github.com/pocketbase/pocketbase/tools/types"
)

// There are two admin roles:
//
//   - the family admin is the owner of a household (whoever created it, or
//     whoever they handed it to). They run that household's tools.
//   - a site admin is any account whose verified email is listed in
//     ADMIN_EMAILS. They run the server-wide settings and all accounts.
//
// The roles are checked by the server on every request; the app only uses
// them to decide which screens to show.

// isSiteAdmin reports whether u signs in with an email listed in ADMIN_EMAILS.
// The email must be verified (Google sign-in, or the confirmation email), or
// anyone could sign up with the admin's address before they do.
func isSiteAdmin(cfg Config, u *core.Record) bool {
	if u == nil || u.Collection().Name != "users" || !u.Verified() || u.GetBool("disabled") {
		return false
	}
	return slices.Contains(cfg.AdminEmails, strings.ToLower(strings.TrimSpace(u.Email())))
}

// listedAdmin reports whether u's email is in ADMIN_EMAILS, verified or not.
func listedAdmin(cfg Config, u *core.Record) bool {
	return slices.Contains(cfg.AdminEmails, strings.ToLower(strings.TrimSpace(u.Email())))
}

// ownedHousehold returns the household u is family admin of, or nil.
func ownedHousehold(app core.App, u *core.Record) *core.Record {
	if u == nil || u.Collection().Name != "users" {
		return nil
	}
	hid := u.GetString("household")
	if hid == "" {
		return nil
	}
	h, err := app.FindRecordById("households", hid)
	if err != nil || h.GetString("owner") != u.Id {
		return nil
	}
	return h
}

func requireSiteAdmin(cfg Config) func(e *core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if !isSiteAdmin(cfg, e.Auth) {
			return e.ForbiddenError("Only a site admin can do that.", nil)
		}
		return e.Next()
	}
}

func requireFamilyAdmin(e *core.RequestEvent) error {
	h := ownedHousehold(e.App, e.Auth)
	if h == nil {
		return e.ForbiddenError("Only the family admin can do that.", nil)
	}
	e.Set("household", h)
	return e.Next()
}

func familyOf(e *core.RequestEvent) *core.Record {
	h, _ := e.Get("household").(*core.Record)
	return h
}

// authFromFileToken lets a plain link (opened in a browser, so without the
// Authorization header) download a backup or CSV export. The app gets a
// short-lived file token and adds it as ?token=.
func authFromFileToken(e *core.RequestEvent) error {
	if e.Auth == nil {
		if tok := e.Request.URL.Query().Get("token"); tok != "" {
			if u, err := e.App.FindAuthRecordByToken(tok, core.TokenTypeFile); err == nil && u.Collection().Name == "users" && !u.GetBool("disabled") {
				e.Auth = u
			}
		}
	}
	if e.Auth == nil {
		return e.UnauthorizedError("Sign in first.", nil)
	}
	return e.Next()
}

func registerAdminRoutes(se *core.ServeEvent, cfg Config) {
	se.Router.GET("/api/whereis/admin/roles", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]any{
			"site":   isSiteAdmin(cfg, e.Auth),
			"family": ownedHousehold(e.App, e.Auth) != nil,
			// shown to someone listed in ADMIN_EMAILS who hasn't confirmed their email yet
			"siteNeedsVerify": e.Auth != nil && listedAdmin(cfg, e.Auth) && !e.Auth.Verified(),
		})
	}).Bind(apis.RequireAuth("users"))

	// downloads opened as links
	dl := se.Router.Group("/api/whereis/admin/download")
	dl.BindFunc(authFromFileToken)
	dl.GET("/export/{kind}", exportCSV).BindFunc(requireFamilyAdmin)
	dl.GET("/backup/{name}", downloadBackup).BindFunc(requireSiteAdmin(cfg))

	f := se.Router.Group("/api/whereis/admin/family")
	f.Bind(apis.RequireAuth("users"))
	f.BindFunc(requireFamilyAdmin)
	f.GET("", familyOverview)
	f.POST("/invite", familyInvite)
	f.POST("/members/{id}/remove", familyRemoveMember)
	f.POST("/members/{id}/reset-email", familyResetEmail)
	f.POST("/owner", familyHandOver)
	f.POST("/import", importCSV)
	f.GET("/duplicates", findDuplicates)
	f.POST("/merge", mergeRecords)
	f.GET("/trash", listTrash)
	f.POST("/trash/{id}/restore", restoreTrash)
	f.DELETE("/trash/{id}", deleteTrash)
	f.GET("/activity", listActivity)
	f.GET("/stats", familyStats)

	s := se.Router.Group("/api/whereis/admin/site")
	s.Bind(apis.RequireAuth("users"))
	s.BindFunc(requireSiteAdmin(cfg))
	s.GET("", siteOverview(cfg))
	s.PUT("/signup", siteSignup(cfg))
	s.PUT("/mail", siteMail(cfg))
	s.POST("/mail/test", siteMailTest)
	s.PUT("/google", siteGoogle(cfg))
	s.POST("/google/check", siteGoogleCheck(cfg))
	s.GET("/users", siteUsers(cfg))
	s.PATCH("/users/{id}", siteUpdateUser(cfg))
	s.DELETE("/users/{id}", siteDeleteUser(cfg))
	s.POST("/users/{id}/password", siteSetPassword(cfg))
	s.POST("/users/{id}/reset-email", siteResetEmail)
	s.GET("/backups", listBackups)
	s.POST("/backups", createBackup)
	s.POST("/backups/upload", uploadBackup)
	s.PUT("/backups/schedule", scheduleBackups)
	s.POST("/backups/{name}/restore", restoreBackup)
	s.DELETE("/backups/{name}", deleteBackup)
}

// bindAdminHooks adds the hooks behind the admin tools: turned-off accounts,
// last activity, the activity log and the recycle bin.
func bindAdminHooks(app core.App, cfg Config) {
	// a turned-off account can't sign in, and its saved sign-ins stop working
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.BindFunc(func(e *core.RequestEvent) error {
			if e.Auth != nil && e.Auth.Collection().Name == "users" && e.Auth.GetBool("disabled") {
				return e.UnauthorizedError("This account is turned off. Ask whoever runs the server.", nil)
			}
			return e.Next()
		})
		return se.Next()
	})
	app.OnRecordAuthRequest("users").BindFunc(func(e *core.RecordAuthRequestEvent) error {
		if e.Record.GetBool("disabled") {
			return e.ForbiddenError("This account is turned off. Ask whoever runs the server.", nil)
		}
		touchLastActive(e.App, e.Record)
		return e.Next()
	})

	app.OnRecordCreateRequest("items", "places").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		detail := ""
		if e.Record.Collection().Name == "items" {
			detail = placePathName(e.App, e.Record.GetString("place"))
		} else {
			detail = placePathName(e.App, e.Record.GetString("parent"))
		}
		logActivity(e.App, e.Record.GetString("household"), authUserID(e.Auth), "added", kindOf(e.Record), e.Record.Id, e.Record.GetString("name"), detail)
		return nil
	})
	app.OnRecordUpdateRequest("items", "places").BindFunc(func(e *core.RecordRequestEvent) error {
		old := e.Record.Original()
		if err := e.Next(); err != nil {
			return err
		}
		logChanges(e.App, old, e.Record, authUserID(e.Auth))
		return nil
	})
	app.OnRecordDeleteRequest("items", "places").BindFunc(func(e *core.RecordRequestEvent) error {
		by := authUserID(e.Auth)
		return e.App.RunInTransaction(func(tx core.App) error {
			e.App = tx
			if err := moveToTrash(tx, e.Record, by); err != nil {
				return e.BadRequestError("Couldn't put it in the recycle bin, so it wasn't deleted. Try again.", err)
			}
			if err := e.Next(); err != nil {
				return err
			}
			logActivity(tx, e.Record.GetString("household"), by, "deleted", kindOf(e.Record), e.Record.Id, e.Record.GetString("name"), "")
			return nil
		})
	})

	// a family admin who leaves or whose account is deleted hands the
	// household to the longest-standing other member
	app.OnRecordDeleteRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := handOverIfOwner(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})

	// the recycle bin keeps things for 30 days
	app.Cron().MustAdd("whereisEmptyTrash", "30 3 * * *", func() {
		emptyOldTrash(app, time.Now().AddDate(0, 0, -trashDays))
	})
}

const trashDays = 30

func kindOf(r *core.Record) string {
	if r.Collection().Name == "places" {
		return "place"
	}
	return "item"
}

func authUserID(auth *core.Record) string {
	if auth != nil && auth.Collection().Name == "users" {
		return auth.Id
	}
	return ""
}

// touchLastActive notes when someone last signed in or reopened the app. It
// writes straight to the table (at most every 10 minutes) so it doesn't
// count as an edit or wake everyone's live updates.
func touchLastActive(app core.App, u *core.Record) {
	last := u.GetDateTime("last_active")
	if !last.IsZero() && time.Since(last.Time()) < 10*time.Minute {
		return
	}
	now := types.NowDateTime()
	_, err := app.DB().Update("users", dbx.Params{"last_active": now.String()}, dbx.HashExp{"id": u.Id}).Execute()
	if err != nil {
		app.Logger().Warn("couldn't note last activity", "error", err)
		return
	}
	u.SetRaw("last_active", now)
}

// logActivity adds a line to the household's activity log. A failure is
// logged, never returned: the log must not block anyone's change.
func logActivity(app core.App, household, by, action, kind, record, name, detail string) {
	if household == "" {
		return
	}
	col, err := app.FindCachedCollectionByNameOrId("activity")
	if err != nil {
		return
	}
	a := core.NewRecord(col)
	a.Set("household", household)
	a.Set("by", by)
	a.Set("action", action)
	a.Set("kind", kind)
	a.Set("record", record)
	a.Set("name", truncate(name, 200))
	a.Set("detail", truncate(detail, 1000))
	if err := app.Save(a); err != nil {
		app.Logger().Warn("couldn't write the activity log", "error", err)
	}
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// logChanges records what an edit changed. Marking a label as printed or a
// sticker as written isn't worth a line.
func logChanges(app core.App, old, rec *core.Record, by string) {
	household := rec.GetString("household")
	kind := kindOf(rec)
	name := rec.GetString("name")
	parentField := "place"
	if kind == "place" {
		parentField = "parent"
	}
	if old.GetString(parentField) != rec.GetString(parentField) {
		logActivity(app, household, by, "moved", kind, rec.Id, name,
			placeOrNone(app, old.GetString(parentField))+" → "+placeOrNone(app, rec.GetString(parentField)))
	}
	if old.GetString("name") != name {
		logActivity(app, household, by, "renamed", kind, rec.Id, name, "was "+old.GetString("name"))
	}
	if old.GetString("note") != rec.GetString("note") || (kind == "item" && old.GetString("photo") != rec.GetString("photo")) {
		logActivity(app, household, by, "edited", kind, rec.Id, name, "")
	}
}

func placeOrNone(app core.App, id string) string {
	if n := placePathName(app, id); n != "" {
		return n
	}
	return "no place"
}

// handOverIfOwner passes a household to another member before its family
// admin leaves it or is deleted. With nobody else in it, nothing changes.
func handOverIfOwner(app core.App, u *core.Record) error {
	h := ownedHousehold(app, u)
	if h == nil {
		return nil
	}
	others, err := app.FindRecordsByFilter("users", "household = {:h} && id != {:u} && disabled = false", "created", 1, 0,
		dbx.Params{"h": h.Id, "u": u.Id})
	if err != nil || len(others) == 0 {
		return err
	}
	h.Set("owner", others[0].Id)
	return app.Save(h)
}

// ---------------------------------------------------------------------
// family: members and invites

type memberInfo struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Email      string `json:"email"`
	LastActive string `json:"last_active"`
	Joined     string `json:"created"`
	Owner      bool   `json:"owner"`
	Disabled   bool   `json:"disabled"`
	Google     bool   `json:"google"`
}

func toMemberInfo(app core.App, u *core.Record, ownerID string) memberInfo {
	google := false
	if ext, err := app.FindAllExternalAuthsByRecord(u); err == nil {
		for _, x := range ext {
			if x.Provider() == "google" {
				google = true
			}
		}
	}
	return memberInfo{
		ID:         u.Id,
		Name:       u.GetString("name"),
		Email:      u.Email(),
		LastActive: u.GetString("last_active"),
		Joined:     u.GetString("created"),
		Owner:      u.Id == ownerID,
		Disabled:   u.GetBool("disabled"),
		Google:     google,
	}
}

func familyOverview(e *core.RequestEvent) error {
	h := familyOf(e)
	users, err := e.App.FindRecordsByFilter("users", "household = {:h}", "created", 0, 0, dbx.Params{"h": h.Id})
	if err != nil {
		return err
	}
	members := make([]memberInfo, 0, len(users))
	for _, u := range users {
		members = append(members, toMemberInfo(e.App, u, h.GetString("owner")))
	}
	return e.JSON(http.StatusOK, map[string]any{
		"household":   h.Id,
		"name":        h.GetString("name"),
		"invite_code": h.GetString("invite_code"),
		"invites_off": h.GetBool("invites_off"),
		"members":     members,
		"mail":        e.App.Settings().SMTP.Enabled,
	})
}

func familyInvite(e *core.RequestEvent) error {
	var body struct {
		Action string `json:"action"` // new, off or on
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request.", err)
	}
	h := familyOf(e)
	switch body.Action {
	case "new":
		h.Set("invite_code", newInviteCode())
		h.Set("invites_off", false)
	case "off":
		h.Set("invites_off", true)
	case "on":
		h.Set("invites_off", false)
	default:
		return e.BadRequestError("Unknown invite action.", nil)
	}
	if err := e.App.Save(h); err != nil {
		return e.InternalServerError("Couldn't change the invite code.", err)
	}
	return familyOverview(e)
}

// familyMember finds a member of the admin's household by the {id} in the path.
func familyMember(e *core.RequestEvent) (*core.Record, error) {
	u, err := e.App.FindRecordById("users", e.Request.PathValue("id"))
	if err != nil || u.GetString("household") != familyOf(e).Id {
		return nil, e.NotFoundError("That person isn't in your household.", nil)
	}
	return u, nil
}

func familyRemoveMember(e *core.RequestEvent) error {
	u, err := familyMember(e)
	if err != nil {
		return err
	}
	if u.Id == e.Auth.Id {
		return e.BadRequestError("You can't remove yourself. Hand over family admin first, then leave in Settings.", nil)
	}
	u.Set("household", "")
	if err := e.App.Save(u); err != nil {
		return e.InternalServerError("Couldn't remove them.", err)
	}
	logActivity(e.App, familyOf(e).Id, e.Auth.Id, "removed", "member", u.Id, displayName(u), "")
	return familyOverview(e)
}

func familyResetEmail(e *core.RequestEvent) error {
	u, err := familyMember(e)
	if err != nil {
		return err
	}
	return sendResetEmail(e, u)
}

func sendResetEmail(e *core.RequestEvent, u *core.Record) error {
	if !e.App.Settings().SMTP.Enabled {
		return e.BadRequestError("Email isn't set up on this server, so reset emails can't be sent. Ask the site admin.", nil)
	}
	if u.Email() == "" {
		return e.BadRequestError("That account has no email address.", nil)
	}
	if err := mails.SendRecordPasswordReset(e.App, u); err != nil {
		return e.BadRequestError("Couldn't send the email: "+err.Error(), err)
	}
	return e.NoContent(http.StatusNoContent)
}

func familyHandOver(e *core.RequestEvent) error {
	var body struct {
		User string `json:"user"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request.", err)
	}
	h := familyOf(e)
	u, err := e.App.FindRecordById("users", body.User)
	if err != nil || u.GetString("household") != h.Id {
		return e.NotFoundError("That person isn't in your household.", nil)
	}
	if u.GetBool("disabled") {
		return e.BadRequestError("That account is turned off.", nil)
	}
	h.Set("owner", u.Id)
	if err := e.App.Save(h); err != nil {
		return e.InternalServerError("Couldn't hand over family admin.", err)
	}
	logActivity(e.App, h.Id, e.Auth.Id, "handed over", "member", u.Id, displayName(u), "family admin")
	return e.NoContent(http.StatusNoContent)
}

func displayName(u *core.Record) string {
	if n := u.GetString("name"); n != "" {
		return n
	}
	return u.Email()
}

// ---------------------------------------------------------------------
// activity log

func listActivity(e *core.RequestEvent) error {
	h := familyOf(e)
	page := 1
	if p := e.Request.URL.Query().Get("page"); p != "" {
		page, _ = strconv.Atoi(p)
	}
	if page < 1 {
		page = 1
	}
	const perPage = 50
	rows, err := e.App.FindRecordsByFilter("activity", "household = {:h}", "-created,-id", perPage+1, (page-1)*perPage, dbx.Params{"h": h.Id})
	if err != nil {
		return err
	}
	more := len(rows) > perPage
	if more {
		rows = rows[:perPage]
	}
	names := map[string]string{}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		by := r.GetString("by")
		if _, ok := names[by]; !ok && by != "" {
			if u, err := e.App.FindRecordById("users", by); err == nil {
				names[by] = displayName(u)
			}
		}
		out = append(out, map[string]any{
			"id": r.Id, "action": r.GetString("action"), "kind": r.GetString("kind"),
			"record": r.GetString("record"), "name": r.GetString("name"), "detail": r.GetString("detail"),
			"by": names[by], "created": r.GetString("created"),
		})
	}
	return e.JSON(http.StatusOK, map[string]any{"items": out, "page": page, "more": more})
}
