package main

import (
	"html/template"
	"net/http"
	"regexp"

	"github.com/pocketbase/pocketbase/core"
)

var recordIDPattern = regexp.MustCompile(`^[a-z0-9]{15}$`)

// The page a QR code or NFC tag opens when the phone's own camera or NFC
// reader hands the link to the browser instead of the app.
var landingTmpl = template.Must(template.New("landing").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Where Is</title>
<style>
:root{color-scheme:light dark;--bg:#f4f6f8;--fg:#17202a;--muted:#5b6672;--accent:#1f6f5c;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#11161b;--fg:#e8edf1;--muted:#9aa6b2;--accent:#5cc4a6;--card:#1a2128}}
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);display:grid;place-items:center;min-height:100vh;padding:0 16px}
main{background:var(--card);border-radius:16px;padding:28px 24px;max-width:360px;width:100%;text-align:center}
h1{font-size:22px;margin:0 0 8px}p{color:var(--muted);margin:0 0 20px}
a.btn{display:block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:14px;border-radius:12px;margin-bottom:12px}
a.alt{color:var(--accent)}
</style></head><body><main>
<h1>{{if eq .Kind "p"}}Open this place{{else}}Open this item{{end}}</h1>
<p>This label belongs to a Where Is household. Open it in the app to see what's here.</p>
<a class="btn" href="intent://{{.Kind}}/{{.ID}}#Intent;scheme=whereis;package={{.Package}};S.browser_fallback_url={{.Download}};end">Open in Where Is</a>
<a class="alt" href="{{.Download}}">Get the Android app</a>
</main></body></html>`))

func landingPage(cfg Config, kind string) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		if !recordIDPattern.MatchString(id) {
			return e.NotFoundError("", nil)
		}
		e.Response.Header().Set("Content-Type", "text/html; charset=utf-8")
		e.Response.Header().Set("Cache-Control", "no-store")
		e.Response.WriteHeader(http.StatusOK)
		return landingTmpl.Execute(e.Response, map[string]string{
			"Kind":     kind,
			"ID":       id,
			"Package":  cfg.AndroidPackage,
			"Download": cfg.AppDownloadURL,
		})
	}
}

// assetLinks lets Android open https://<server>/p/... links straight in the
// app once the signing key's fingerprint is configured.
func assetLinks(cfg Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		if len(cfg.AndroidCertSHA256) == 0 {
			return e.JSON(http.StatusOK, []any{})
		}
		return e.JSON(http.StatusOK, []map[string]any{{
			"relation": []string{"delegate_permission/common.handle_all_urls"},
			"target": map[string]any{
				"namespace":                "android_app",
				"package_name":             cfg.AndroidPackage,
				"sha256_cert_fingerprints": cfg.AndroidCertSHA256,
			},
		}})
	}
}

func homePage(e *core.RequestEvent) error {
	return e.HTML(http.StatusOK, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Where Is</title><p style="font:16px system-ui;padding:24px">Where Is server is running. Use the Where Is app to sign in. Admins: <a href="/_/">dashboard</a>.</p>`)
}
