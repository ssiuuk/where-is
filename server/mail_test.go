package main

import (
	"bytes"
	"errors"
	"log"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// logBuf collects what the server prints to the container log. Emails can
// be sent from another goroutine, so it locks.
type logBuf struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *logBuf) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *logBuf) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

func (b *logBuf) Reset() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.buf.Reset()
}

func captureLog(t *testing.T) *logBuf {
	b := &logBuf{}
	prev := log.Writer()
	log.SetOutput(b)
	t.Cleanup(func() { log.SetOutput(prev) })
	return b
}

func waitFor(t testing.TB, ok func() bool) {
	t.Helper()
	for i := 0; i < 100 && !ok(); i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if !ok() {
		t.Fatal("timed out")
	}
}

func TestVerifyEmail(t *testing.T) {
	f := adminFixture(t)
	defer f.app.Cleanup()
	out := captureLog(t)
	verify := func(name string, u *core.Record, status int, want ...string) {
		t.Helper()
		run(t, f, tests.ApiScenario{
			Name: name, Method: http.MethodPost, URL: "/api/whereis/admin/verify-email",
			Headers: asUser(t, u), ExpectedStatus: status, ExpectedContent: want,
		})
	}
	eve := f.user(t, "eve@example.com", "")

	verify("no mail server", eve, 400, "Email isn't set up", "SMTP_HOST")
	if !strings.Contains(out.String(), "eve@example.com not sent") {
		t.Fatalf("nothing in the log: %q", out.String())
	}

	s := f.app.Settings()
	s.SMTP.Enabled = true
	s.SMTP.Host = "smtp.example.com"
	s.SMTP.Port = 587
	s.Meta.SenderAddress = "whereis@example.com"
	if err := f.app.Save(s); err != nil {
		t.Fatal(err)
	}
	verify("no public address", eve, 400, "PUBLIC_URL")

	s.Meta.AppURL = "https://whereis.example.com"
	if err := f.app.Save(s); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	verify("sent", eve, 200, `"to":"eve@example.com"`)
	if n := f.app.TestMailer.TotalSend(); n != 1 {
		t.Fatalf("sent %d emails", n)
	}
	if m := f.app.TestMailer.LastMessage(); !strings.Contains(m.HTML, "https://whereis.example.com/") || m.To[0].Address != "eve@example.com" {
		t.Fatalf("to %v, body %s", m.To, m.HTML)
	}
	if !strings.Contains(out.String(), "sent to eve@example.com") {
		t.Fatalf("send not logged: %q", out.String())
	}
	verify("again straight away", eve, 429, "spam folder")
	verify("already confirmed", f.dan, 200, `"verified":true`)

	// the mail server refuses: the person and the log both hear about it
	ben := f.ben
	f.app.OnMailerSend().BindFunc(func(e *core.MailerEvent) error {
		return errors.New("535 authentication failed")
	})
	out.Reset()
	verify("mail server error", ben, 400, "535 authentication failed")
	if !strings.Contains(out.String(), "ben@example.com failed: 535 authentication failed") {
		t.Fatalf("failure not logged: %q", out.String())
	}
}

// Password reset emails go out in the background, so a failure must at
// least reach the container log.
func TestBackgroundMailFailureIsLogged(t *testing.T) {
	f := newFixture(t)
	defer f.app.Cleanup()
	out := captureLog(t)
	run(t, f, tests.ApiScenario{
		Name: "reset with no mail server", Method: http.MethodPost,
		URL:            "/api/collections/users/request-password-reset",
		Body:           strings.NewReader(`{"email":"ann@example.com"}`),
		ExpectedStatus: 204,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
			waitFor(t, func() bool { return strings.Contains(out.String(), "ann@example.com not sent") })
			if app.TestMailer.TotalSend() != 0 {
				t.Fatal("an email went out with no mail server set")
			}
		},
	})
}
